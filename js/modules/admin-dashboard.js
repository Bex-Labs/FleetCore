/**
 * ADMIN-DASHBOARD.JS — Real-time telemetry, live queries, persistent Leaflet map,
 * smooth marker interpolation, 48-hour inactivity stale filter, and fleet alerts.
 */

import { supabase, getUserProfile, formatNaira, timeAgo, escapeHtml } from '../config.js';

let leafletMap = null;
let leafletMarkers = {};
let markerAnimationFrames = {}; // Track active animation frames per vehicle
let vehicleMetaCache = {};      // Cache vehicle info (plate_number, model, name)
let currentOrgId = null;

const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 Hours in milliseconds

// Initialize on page load
if (document.getElementById('kpi-active-vehicles')) {
  initDashboard();
}

async function initDashboard() {
  initLeafletMap();

  const profile = await getUserProfile();
  if (!profile) return;
  
  currentOrgId = profile.organization_id;

  // Hydrate header user information
  const headerName = document.getElementById('header-user-name');
  const headerAvatar = document.getElementById('header-avatar');
  if (headerName) headerName.textContent = profile.full_name || 'Fleet Administrator';
  if (headerAvatar && profile.full_name) {
    const initials = profile.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    headerAvatar.textContent = initials;
  }

  // Fetch and display organization name
  if (currentOrgId) {
    const { data: org, error } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', currentOrgId)
      .single();
    
    if (org && !error && document.getElementById('fc-org-name')) {
      document.getElementById('fc-org-name').textContent = org.name;
    }
  }

  // Run initial dashboard queries & bind realtime subscriptions
  await Promise.all([
    loadKpis(currentOrgId),
    loadVehicleLocations(currentOrgId),
    loadActivityFeed(currentOrgId),
  ]);

  setupRealtimeSubscriptions(currentOrgId);
}

/**
 * Initialize persistent Leaflet Map Canvas
 */
function initLeafletMap() {
  const mapElement = document.getElementById('fleet-leaflet-map');
  if (!mapElement || leafletMap) return;
  if (typeof L === 'undefined') return;

  leafletMap = L.map('fleet-leaflet-map', { 
    zoomControl: true, 
    attributionControl: false 
  }).setView([10.49046, 7.46114], 14);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
    maxZoom: 19 
  }).addTo(leafletMap);

  setTimeout(() => {
    if (leafletMap) leafletMap.invalidateSize();
  }, 300);
}

window.refreshDashboard = function() {
  if (currentOrgId) {
    loadKpis(currentOrgId);
    loadVehicleLocations(currentOrgId);
    loadActivityFeed(currentOrgId);
  }
};

/**
 * Load Top Summary KPI Statistics
 */
async function loadKpis(orgId) {
  if (!orgId) return;

  const monthStart = new Date(); 
  monthStart.setDate(1); 
  monthStart.setHours(0, 0, 0, 0);

  const [vehicles, trips, drivers, incidents, fuel] = await Promise.all([
    supabase.from('vehicles').select('id, status', { count: 'exact' }).eq('organization_id', orgId),
    supabase.from('trips').select('id, status', { count: 'exact' }).eq('organization_id', orgId),
    supabase.from('profiles').select('id, status', { count: 'exact' }).eq('organization_id', orgId).eq('role', 'driver'),
    supabase.from('incidents').select('id, status', { count: 'exact' }).eq('organization_id', orgId).in('status', ['open', 'investigating']),
    supabase.from('fuel_logs').select('amount_naira').eq('organization_id', orgId).gte('logged_at', monthStart.toISOString()),
  ]);

  const activeVehicles = (vehicles.data || []).filter(v => v.status === 'active').length;
  const activeTrips = (trips.data || []).filter(t => t.status === 'in_progress').length;
  const activeDrivers = (drivers.data || []).filter(d => d.status === 'active').length;
  const openIncidents = incidents.count ?? (incidents.data || []).length;
  const fuelSpend = (fuel.data || []).reduce((sum, f) => sum + Number(f.amount_naira || 0), 0);

  setKpi('kpi-active-vehicles', activeVehicles);
  setKpi('kpi-active-trips', activeTrips);
  setKpi('kpi-drivers-on-duty', activeDrivers);
  setKpi('kpi-incidents', openIncidents);
  setKpi('kpi-fuel-spend', formatNaira(fuelSpend));

  document.querySelectorAll('[data-kpi-trend]').forEach(el => {
    const type = el.getAttribute('data-kpi-trend');
    if (type === 'vehicles') el.textContent = `${vehicles.count ?? (vehicles.data || []).length} total units`;
    if (type === 'trips') el.textContent = `${activeTrips} vehicles on route`;
    if (type === 'drivers') el.textContent = `${drivers.count ?? (drivers.data || []).length} total drivers`;
    if (type === 'incidents') el.textContent = openIncidents > 0 ? `${openIncidents} unresolved cases` : 'No open issues';
    if (type === 'fuel') el.textContent = 'Current billing cycle';
  });
}

function setKpi(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

/**
 * Custom styling for Leaflet bus markers
 */
function createBusMarkerIcon(isActive) {
  return L.divIcon({
    className: 'custom-bus-pin',
    html: `
      <div class="relative flex items-center justify-center">
        ${isActive ? '<span class="animate-ping absolute inline-flex h-7 w-7 rounded-full bg-teal-400 opacity-60"></span>' : ''}
        <div class="w-8 h-8 rounded-xl ${isActive ? 'bg-teal-600' : 'bg-slate-600'} text-white shadow-lg border-2 border-white flex items-center justify-center text-sm">
          <i class="bi bi-truck"></i>
        </div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18]
  });
}

/**
 * Smoothly interpolates marker positions between updates
 */
function animateMarker(vehicleId, marker, startLatLng, endLatLng, durationMs = 4500) {
  if (markerAnimationFrames[vehicleId]) {
    cancelAnimationFrame(markerAnimationFrames[vehicleId]);
  }

  if (startLatLng[0] === endLatLng[0] && startLatLng[1] === endLatLng[1]) {
    marker.setLatLng(endLatLng);
    return;
  }

  const startTime = performance.now();

  function step(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / durationMs, 1);
    const easeOut = 1 - Math.pow(1 - progress, 3);

    const currentLat = startLatLng[0] + (endLatLng[0] - startLatLng[0]) * easeOut;
    const currentLng = startLatLng[1] + (endLatLng[1] - startLatLng[1]) * easeOut;

    marker.setLatLng([currentLat, currentLng]);

    if (progress < 1) {
      markerAnimationFrames[vehicleId] = requestAnimationFrame(step);
    } else {
      delete markerAnimationFrames[vehicleId];
    }
  }

  markerAnimationFrames[vehicleId] = requestAnimationFrame(step);
}

/**
 * Load Vehicle Coordinates onto the Active Map
 */
async function loadVehicleLocations(orgId) {
  if (!orgId || !leafletMap) return;

  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, name, plate_number, model, tracker_imei')
    .eq('organization_id', orgId);

  (vehicles || []).forEach(v => {
    vehicleMetaCache[v.id] = v;
  });

  const vehicleIds = (vehicles || []).map(v => v.id);

  // Calculate 48-hour cutoff timestamp
  const cutoff48h = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();

  let locations = [];
  if (vehicleIds.length) {
    const { data } = await supabase
      .from('vehicle_locations')
      .select('*')
      .in('vehicle_id', vehicleIds)
      .eq('is_active', true)
      .gte('last_updated', cutoff48h); // 48-Hour Stale Vehicle Expiry
    locations = data || [];
  }

  updateMapHeaderBadge(locations.length);

  // Clear existing markers
  Object.keys(leafletMarkers).forEach(vId => {
    leafletMarkers[vId].remove();
    delete leafletMarkers[vId];
  });

  if (locations.length === 0) return;

  const bounds = [];
  locations.forEach(loc => {
    const vInfo = vehicleMetaCache[loc.vehicle_id] || { 
      plate_number: 'Vehicle', 
      model: 'Fleet Unit',
      name: 'Active Bus'
    };
    
    const marker = L.marker([loc.lat, loc.lng], {
      icon: createBusMarkerIcon(loc.is_active)
    }).addTo(leafletMap);

    marker.bindPopup(`
      <div class="font-sans text-xs p-1">
        <div class="font-bold text-slate-900 text-sm">${escapeHtml(vInfo.plate_number)}</div>
        <div class="text-[11px] font-semibold text-slate-600">${escapeHtml(vInfo.name || vInfo.model)}</div>
        <div class="mt-2 pt-1.5 border-t border-slate-100 flex items-center justify-between gap-3">
          <span class="text-teal-600 font-bold"><i class="bi bi-speedometer2"></i> ${loc.speed || 0} km/h</span>
          <span class="text-[10px] text-slate-400">${timeAgo(loc.last_updated)}</span>
        </div>
      </div>
    `);

    leafletMarkers[loc.vehicle_id] = marker;
    bounds.push([loc.lat, loc.lng]);
  });

  if (bounds.length === 1) {
    leafletMap.setView(bounds[0], 15);
  } else if (bounds.length > 1) {
    leafletMap.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
  }
}

function updateMapHeaderBadge(count) {
  const badge = document.getElementById('map-online-count');
  const text = document.getElementById('map-online-text');
  const pulse = document.getElementById('map-radar-pulse');
  
  if (!badge || !text) return;

  if (count > 0) {
    badge.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-bold text-[11px] border border-emerald-200/60";
    if (pulse) pulse.className = "w-2 h-2 rounded-full bg-emerald-500 animate-pulse";
    text.textContent = `Active Tracking (${count} Units)`;
  } else {
    badge.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 font-bold text-[11px] border border-slate-200";
    if (pulse) pulse.className = "w-2 h-2 rounded-full bg-slate-400";
    text.textContent = `Radar Standby (0 Active Units)`;
  }
}

/**
 * Setup Realtime Subscriptions for GPS Location, Trips, and Incidents
 */
function setupRealtimeSubscriptions(orgId) {
  if (!orgId) return;

  supabase.channel(`fleet-dashboard-realtime-${orgId}`)
    // Listen for GPS Telematics Coordinate Updates
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_locations' }, async (payload) => {
      const loc = payload.new;
      if (!loc) return;

      // Check if coordinate is older than 48 hours
      const isStale = loc.last_updated 
        ? (Date.now() - new Date(loc.last_updated).getTime()) > STALE_THRESHOLD_MS
        : false;

      // Remove marker if marked inactive or inactive for > 48 hours
      if (!loc.is_active || isStale) {
        if (leafletMarkers[loc.vehicle_id]) {
          leafletMarkers[loc.vehicle_id].remove();
          delete leafletMarkers[loc.vehicle_id];
        }
        updateMapHeaderBadge(Object.keys(leafletMarkers).length);
        return;
      }

      // Hydrate metadata cache if missing
      if (!vehicleMetaCache[loc.vehicle_id]) {
        const { data: v } = await supabase
          .from('vehicles')
          .select('id, name, plate_number, model')
          .eq('id', loc.vehicle_id)
          .maybeSingle();
        if (v) vehicleMetaCache[v.id] = v;
      }

      const vInfo = vehicleMetaCache[loc.vehicle_id] || { 
        plate_number: 'Vehicle', 
        name: 'Fleet Bus',
        model: 'Unit' 
      };

      if (leafletMap) {
        const popupContent = `
          <div class="font-sans text-xs p-1">
            <div class="font-bold text-slate-900 text-sm">${escapeHtml(vInfo.plate_number)}</div>
            <div class="text-[11px] font-semibold text-slate-600">${escapeHtml(vInfo.name || vInfo.model)}</div>
            <div class="mt-2 pt-1.5 border-t border-slate-100 flex items-center justify-between gap-3">
              <span class="text-teal-600 font-bold"><i class="bi bi-speedometer2"></i> ${loc.speed || 0} km/h</span>
              <span class="text-[10px] text-slate-400">${timeAgo(loc.last_updated)}</span>
            </div>
          </div>
        `;

        if (leafletMarkers[loc.vehicle_id]) {
          const currentPos = leafletMarkers[loc.vehicle_id].getLatLng();
          const targetPos = [loc.lat, loc.lng];
          
          // Animate pin movement smoothly
          animateMarker(loc.vehicle_id, leafletMarkers[loc.vehicle_id], [currentPos.lat, currentPos.lng], targetPos, 4500);
          leafletMarkers[loc.vehicle_id].setPopupContent(popupContent);
        } else {
          const marker = L.marker([loc.lat, loc.lng], {
            icon: createBusMarkerIcon(true)
          }).addTo(leafletMap);
          marker.bindPopup(popupContent);
          leafletMarkers[loc.vehicle_id] = marker;
        }
      }
      updateMapHeaderBadge(Object.keys(leafletMarkers).length);
    })
    // Listen for Trips Started / Finished
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trips', filter: `organization_id=eq.${orgId}` }, (payload) => {
      const trip = payload.new;
      if (trip && payload.eventType === 'INSERT') {
        if (window.showToast) window.showToast(`New trip initiated: ${trip.origin || 'Base'} → ${trip.destination || 'Destination'}`, 'info');
      }
      loadKpis(orgId);
      loadActivityFeed(orgId);
    })
    // Listen for Incidents
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'incidents', filter: `organization_id=eq.${orgId}` }, (payload) => {
      const inc = payload.new;
      if (inc && window.showToast) {
        window.showToast(`New Incident Alert: ${inc.incident_type || 'Issue'} reported!`, 'warning');
      }
      loadKpis(orgId);
      loadActivityFeed(orgId);
    })
    .subscribe();
}

/**
 * Live Activity & Incident Feed Loader
 */
async function loadActivityFeed(orgId) {
  const list = document.getElementById('activity-feed-list');
  if (!list || !orgId) return;

  const [trips, incidents, workOrders, fuel] = await Promise.all([
    supabase.from('trips').select('id, origin, destination, status, created_at, vehicle:vehicles(plate_number)').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(5),
    supabase.from('incidents').select('id, incident_type, severity, created_at, vehicle:vehicles(plate_number)').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(5),
    supabase.from('work_orders').select('id, service_type, status, created_at, vehicle:vehicles(plate_number)').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(5),
    supabase.from('fuel_logs').select('id, amount_naira, logged_at, vehicle:vehicles(plate_number)').eq('organization_id', orgId).order('logged_at', { ascending: false }).limit(5),
  ]);

  const items = [];

  (trips.data || []).forEach(t => items.push({
    time: t.created_at, 
    icon: 'bi-signpost-2', 
    iconCls: 'bg-teal-50 text-teal-600',
    title: t.status === 'completed' ? 'Trip Completed' : t.status === 'in_progress' ? 'Trip In-Transit' : 'Trip Scheduled',
    detail: `${escapeHtml(t.origin || 'Base')} → ${escapeHtml(t.destination || 'Destination')}${t.vehicle ? ` · ${escapeHtml(t.vehicle.plate_number)}` : ''}`,
  }));

  (incidents.data || []).forEach(i => items.push({
    time: i.created_at, 
    icon: 'bi-exclamation-triangle', 
    iconCls: 'bg-rose-50 text-rose-600',
    title: `${(i.incident_type || 'Incident').replace(/^\w/, c => c.toUpperCase())} Reported`,
    detail: `Severity: ${escapeHtml(i.severity || 'Normal')}${i.vehicle ? ` · ${escapeHtml(i.vehicle.plate_number)}` : ''}`,
  }));

  (workOrders.data || []).forEach(w => items.push({
    time: w.created_at, 
    icon: 'bi-tools', 
    iconCls: 'bg-blue-50 text-blue-600',
    title: w.status === 'completed' ? 'Service Completed' : 'Maintenance Scheduled',
    detail: `${escapeHtml(w.service_type || 'General Inspection')}${w.vehicle ? ` · ${escapeHtml(w.vehicle.plate_number)}` : ''}`,
  }));

  (fuel.data || []).forEach(f => items.push({
    time: f.logged_at, 
    icon: 'bi-fuel-pump', 
    iconCls: 'bg-amber-50 text-amber-600',
    title: 'Fuel Receipt Logged',
    detail: `${formatNaira(f.amount_naira)}${f.vehicle ? ` · ${escapeHtml(f.vehicle.plate_number)}` : ''}`,
  }));

  items.sort((a, b) => new Date(b.time) - new Date(a.time));
  const top = items.slice(0, 8);

  if (top.length === 0) {
    list.innerHTML = `
      <li class="p-6 text-center text-slate-400">
        <i class="bi bi-inbox text-2xl block mb-1"></i>
        <span class="text-xs font-medium">No recent activity recorded.</span>
      </li>`;
    return;
  }

  list.innerHTML = top.map(item => `
    <li class="p-2.5 hover:bg-slate-50 rounded-xl transition border border-transparent hover:border-slate-100 flex items-start gap-3">
      <div class="p-2 ${item.iconCls} rounded-lg text-xs mt-0.5 shrink-0">
        <i class="bi ${item.icon}"></i>
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex justify-between items-start gap-1">
          <span class="text-xs font-bold text-slate-800 truncate">${item.title}</span>
          <span class="text-[10px] font-semibold text-slate-400 shrink-0">${timeAgo(item.time)}</span>
        </div>
        <p class="text-[11px] text-slate-500 truncate mt-0.5">${item.detail}</p>
      </div>
    </li>`).join('');
}

/**
 * Handle Fleet Broadcast Submission
 */
window.handleSendBroadcast = async function(e) {
  e.preventDefault();
  const btn = document.getElementById('broadcast-submit-btn');
  const message = document.getElementById('broadcast-message').value.trim();
  const priority = document.getElementById('broadcast-priority').value;

  if (!message || !currentOrgId) return;

  btn.disabled = true;
  btn.innerHTML = `<i class="bi bi-arrow-repeat animate-spin"></i><span>Broadcasting...</span>`;

  try {
    const { error } = await supabase.from('fleet_alerts').insert({
      organization_id: currentOrgId,
      message: message,
      priority: priority,
      created_at: new Date().toISOString()
    });

    if (error) throw error;

    if (window.showToast) {
      window.showToast('Broadcast alert successfully transmitted to fleet.', 'success');
    }
    
    document.getElementById('broadcast-message').value = '';
    window.closeBroadcastModal();
  } catch (err) {
    if (window.showToast) {
      window.showToast(err.message || 'Failed to send broadcast.', 'error');
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="bi bi-send-fill"></i><span>Send Broadcast</span>`;
  }
};