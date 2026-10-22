/**
 * ADMIN-DISPATCH.JS — Route Architect & Sequencer (Default) + Dispatch Board.
 */

import { supabase, getUserProfile, formatDate, escapeHtml, avatarDataUri, createTileLayer } from '../config.js';
import { showToast, performLogout } from '../auth.js';

let orgId = null;
let trips = [];
let vehicles = [];
let drivers = [];
let routes = [];
let activeRoute = null;
let activeStops = [];
let incidentTripIds = new Set();

let architectMap = null;
let mapMarkers = [];
let mapPolyline = null;

const routeMapEl = document.getElementById('route-map');
if (routeMapEl) initDispatch();

export async function initDispatch() {
  const profile = await getUserProfile();
  if (!profile) return;
  orgId = profile.organization_id;

  const headerName = document.getElementById('header-user-name');
  const headerAvatar = document.getElementById('header-avatar');
  if (headerName) headerName.textContent = profile.full_name || 'Admin';
  if (headerAvatar && profile.full_name) {
    headerAvatar.textContent = profile.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  }

  // Organization name
  let orgName = 'TransCore Logistics';
  if (orgId) {
    const { data: org } = await supabase.from('organizations').select('name').eq('id', orgId).maybeSingle();
    if (org?.name) orgName = org.name;
  }
  document.querySelectorAll('#fc-org-name').forEach(el => el.textContent = orgName);

  // Initialize Route Architect as the default main view
  initRouteMap();
  await Promise.all([loadVehicles(), loadDrivers(), loadRoutes()]);
  await loadTrips();

  document.querySelectorAll('.fc-create-trip-btn').forEach(btn => btn.addEventListener('click', openCreateModal));
  document.getElementById('trip-form')?.addEventListener('submit', onCreateSubmit);
}

// ─── VIEW SWITCHER (ROUTE ARCHITECT IS PRIMARY) ───────────────────────────
window.switchViewMode = function(mode) {
  const kanbanView = document.getElementById('view-kanban');
  const architectView = document.getElementById('view-architect');
  const btnKanban = document.getElementById('tab-btn-kanban');
  const btnArchitect = document.getElementById('tab-btn-architect');

  if (mode === 'kanban') {
    architectView.classList.add('hidden');
    kanbanView.classList.remove('hidden');
    btnKanban.className = "px-3 py-1.5 rounded-lg bg-white text-slate-900 shadow-sm transition";
    btnArchitect.className = "px-3 py-1.5 rounded-lg text-slate-500 hover:text-slate-900 transition";
  } else {
    kanbanView.classList.add('hidden');
    architectView.classList.remove('hidden');
    btnArchitect.className = "px-3 py-1.5 rounded-lg bg-white text-slate-900 shadow-sm transition";
    btnKanban.className = "px-3 py-1.5 rounded-lg text-slate-500 hover:text-slate-900 transition";
    
    setTimeout(() => {
      initRouteMap();
      architectMap?.invalidateSize();
    }, 150);
  }
};

// ─── ROUTE ARCHITECT LOGIC ────────────────────────────────────────────────
function initRouteMap() {
  if (architectMap || typeof L === 'undefined') return;

  architectMap = L.map('route-map', { zoomControl: true }).setView([9.0820, 8.6753], 12);
  const tileLayer = createTileLayer();
  if (tileLayer) tileLayer.addTo(architectMap);

  architectMap.on('click', (e) => {
    const { lat, lng } = e.latlng;
    document.getElementById('new-stop-name').value = `Waypoint @ ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    appendStopToSequence(lat, lng);
  });
}

async function loadRoutes() {
  const { data } = await supabase.from('routes').select('*').eq('organization_id', orgId).order('name');
  routes = data || [];

  const countBadge = document.getElementById('route-count-badge');
  if (countBadge) countBadge.textContent = `${routes.length} Routes`;

  const presetSelect = document.getElementById('trip-route-preset');
  if (presetSelect) {
    presetSelect.innerHTML = `<option value="">Custom Point-to-Point...</option>` +
      routes.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  }

  const listEl = document.getElementById('route-library-list');
  if (!listEl) return;

  if (routes.length === 0) {
    listEl.innerHTML = `<div class="text-center py-6 text-slate-400 text-xs">No routes created yet.</div>`;
    return;
  }

  listEl.innerHTML = routes.map(r => `
    <div class="p-2.5 rounded-xl border border-slate-200 hover:border-teal-500 cursor-pointer transition flex items-center justify-between ${activeRoute?.id === r.id ? 'bg-teal-50 border-teal-500' : 'bg-slate-50'}" onclick="selectRouteToEdit('${r.id}')">
      <div>
        <span class="text-xs font-bold text-slate-800 block truncate">${escapeHtml(r.name)}</span>
        <span class="text-[10px] text-slate-400">Click to sequence stops</span>
      </div>
      <i class="bi bi-chevron-right text-xs text-slate-400"></i>
    </div>`).join('');

  if (!activeRoute && routes.length > 0) {
    selectRouteToEdit(routes[0].id);
  }
}

window.selectRouteToEdit = async function(routeId) {
  activeRoute = routes.find(r => r.id === routeId);
  if (!activeRoute) return;

  document.getElementById('active-route-title').textContent = activeRoute.name;

  const { data: stops } = await supabase
    .from('stops')
    .select('*')
    .eq('route_id', routeId)
    .order('order_index', { ascending: true });

  activeStops = stops || [];
  renderStopsSequence();
  renderMapRoute();
  loadRoutes();
};

function renderStopsSequence() {
  const tbody = document.getElementById('sequence-tbody');
  const countLabel = document.getElementById('sequence-count');
  if (countLabel) countLabel.textContent = `${activeStops.length} STOPS CONFIGURED`;

  if (activeStops.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-slate-400 text-xs">No stops sequenced on this route yet. Pin stops on the map.</td></tr>`;
    return;
  }

  tbody.innerHTML = activeStops.map((s, idx) => `
    <tr class="hover:bg-slate-50 transition">
      <td class="py-2.5 px-3 font-mono font-bold text-slate-400">${idx + 1}</td>
      <td class="py-2.5 px-3 font-bold text-slate-800">${escapeHtml(s.name)}</td>
      <td class="py-2.5 px-3 font-mono text-slate-500">${s.arrival_time || '--:--'}</td>
      <td class="py-2.5 px-3 font-mono text-slate-500">${s.capacity || 0} units</td>
      <td class="py-2.5 px-3 text-right">
        <button onclick="removeStopFromSequence(${idx})" class="p-1 text-slate-400 hover:text-rose-600 transition" title="Delete stop"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`).join('');
}

function renderMapRoute() {
  if (!architectMap) return;

  mapMarkers.forEach(m => architectMap.removeLayer(m));
  mapMarkers = [];
  if (mapPolyline) architectMap.removeLayer(mapPolyline);

  if (activeStops.length === 0) return;

  const latlngs = [];
  activeStops.forEach((s, idx) => {
    if (s.lat && s.lng) {
      const pos = [s.lat, s.lng];
      latlngs.push(pos);

      const markerIcon = L.divIcon({
        className: 'route-stop-pin',
        html: `<div class="w-6 h-6 rounded-full bg-brand-navy text-white text-[10px] font-black border-2 border-white shadow-lg flex items-center justify-center">${idx + 1}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      const m = L.marker(pos, { icon: markerIcon }).addTo(architectMap).bindPopup(`<b>Stop ${idx + 1}: ${escapeHtml(s.name)}</b>`);
      mapMarkers.push(m);
    }
  });

  if (latlngs.length > 1) {
    mapPolyline = L.polyline(latlngs, { color: '#00A896', weight: 4, dashArray: '6, 8' }).addTo(architectMap);
    architectMap.fitBounds(mapPolyline.getBounds(), { padding: [40, 40] });
  } else if (latlngs.length === 1) {
    architectMap.setView(latlngs[0], 14);
  }
}

window.appendStopToSequence = function(lat = null, lng = null) {
  if (!activeRoute) {
    showToast('Select or create a route first.', 'error');
    return;
  }

  const nameInput = document.getElementById('new-stop-name');
  const timeInput = document.getElementById('new-stop-time');
  const capInput = document.getElementById('new-stop-capacity');

  const name = nameInput.value.trim() || `Stop ${activeStops.length + 1}`;
  const arrival = timeInput.value || '08:00';
  const cap = Number(capInput.value) || 0;

  activeStops.push({
    route_id: activeRoute.id,
    organization_id: orgId,
    name,
    arrival_time: arrival,
    capacity: cap,
    order_index: activeStops.length,
    lat: lat || (architectMap ? architectMap.getCenter().lat : 9.0820),
    lng: lng || (architectMap ? architectMap.getCenter().lng : 8.6753)
  });

  nameInput.value = '';
  renderStopsSequence();
  renderMapRoute();
};

window.removeStopFromSequence = function(index) {
  activeStops.splice(index, 1);
  activeStops.forEach((s, idx) => s.order_index = idx);
  renderStopsSequence();
  renderMapRoute();
};

window.saveActiveRouteSequence = async function() {
  if (!activeRoute) {
    showToast('No active route selected.', 'error');
    return;
  }

  await supabase.from('stops').delete().eq('route_id', activeRoute.id);
  if (activeStops.length > 0) {
    const { error } = await supabase.from('stops').insert(activeStops.map(s => ({
      route_id: activeRoute.id,
      organization_id: orgId,
      name: s.name,
      arrival_time: s.arrival_time,
      capacity: s.capacity,
      order_index: s.order_index,
      lat: s.lat,
      lng: s.lng
    })));

    if (error) {
      showToast(error.message, 'error');
      return;
    }
  }

  showToast('Route stop sequence synced successfully.', 'success');
};

window.openNewRouteModal = function() {
  document.getElementById('create-route-modal')?.classList.remove('hidden');
};
window.closeNewRouteModal = function() {
  document.getElementById('create-route-modal')?.classList.add('hidden');
};

window.submitCreateRoute = async function() {
  const name = document.getElementById('new-route-name-input').value.trim();
  if (!name) {
    showToast('Enter a route name.', 'error');
    return;
  }

  const { data, error } = await supabase.from('routes').insert({
    organization_id: orgId,
    name: name
  }).select().single();

  if (error) {
    showToast(error.message, 'error');
    return;
  }

  showToast('Route created.', 'success');
  closeNewRouteModal();
  document.getElementById('new-route-name-input').value = '';
  await loadRoutes();
  selectRouteToEdit(data.id);
};

// ─── KANBAN DISPATCH LOGIC ───────────────────────────────────────────────
window.onSelectRoutePreset = async function(routeId) {
  if (!routeId) return;
  const route = routes.find(r => r.id === routeId);
  if (!route) return;

  const { data: stops } = await supabase
    .from('stops')
    .select('name')
    .eq('route_id', routeId)
    .order('order_index', { ascending: true });

  if (stops && stops.length > 1) {
    document.getElementById('trip-origin').value = stops[0].name;
    document.getElementById('trip-destination').value = stops[stops.length - 1].name;
    document.getElementById('trip-notes').value = `Routed via ${stops.length} sequence waypoints.`;
  }
};

async function loadVehicles() {
  const { data } = await supabase.from('vehicles').select('id, plate_number').eq('organization_id', orgId).order('plate_number');
  vehicles = data || [];
  const select = document.getElementById('trip-vehicle');
  if (select) {
    select.innerHTML = vehicles.length
      ? vehicles.map(v => `<option value="${v.id}">${escapeHtml(v.plate_number)}</option>`).join('')
      : `<option value="">No vehicles available</option>`;
  }
}

async function loadDrivers() {
  const { data } = await supabase.from('profiles').select('id, full_name').eq('organization_id', orgId).eq('role', 'driver').order('full_name');
  drivers = data || [];
  const select = document.getElementById('trip-driver');
  if (select) {
    select.innerHTML = drivers.length
      ? drivers.map(d => `<option value="${d.id}">${escapeHtml(d.full_name || 'Driver')}</option>`).join('')
      : `<option value="">No drivers available</option>`;
  }
}

window.loadTrips = async function() {
  ['col-pending', 'col-transit', 'col-completed', 'col-issues'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<div class="p-6 text-center text-slate-400 text-xs font-medium">Fetching trips...</div>`;
  });

  try {
    const [tripsRes, vehiclesRes, driversRes, incidentsRes] = await Promise.all([
      supabase.from('trips').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
      supabase.from('vehicles').select('id, plate_number').eq('organization_id', orgId),
      supabase.from('profiles').select('id, full_name').eq('organization_id', orgId),
      supabase.from('incidents').select('trip_id').eq('organization_id', orgId).not('trip_id', 'is', null).in('status', ['open', 'investigating']),
    ]);

    if (tripsRes.error) throw tripsRes.error;

    const vMap = Object.fromEntries((vehiclesRes.data || []).map(v => [v.id, v]));
    const dMap = Object.fromEntries((driversRes.data || []).map(d => [d.id, d]));

    trips = (tripsRes.data || []).map(t => ({
      ...t,
      vehicle: vMap[t.vehicle_id] || null,
      driver: dMap[t.driver_id] || null,
    }));

    incidentTripIds = new Set((incidentsRes.data || []).map(i => i.trip_id));
    render();

  } catch (err) {
    console.error('Trip loading error:', err);
  }
};

function render() {
  const buckets = { pending: [], transit: [], completed: [], issues: [] };
  
  trips.forEach(t => {
    if (t.status === 'cancelled' || incidentTripIds.has(t.id)) buckets.issues.push(t);
    else if (t.status === 'pending') buckets.pending.push(t);
    else if (t.status === 'in_progress') buckets.transit.push(t);
    else if (t.status === 'completed') buckets.completed.push(t);
  });

  setCount('count-pending', buckets.pending.length);
  setCount('count-transit', buckets.transit.length);
  setCount('count-completed', buckets.completed.length);
  setCount('count-issues', buckets.issues.length);

  fillColumn('col-pending', buckets.pending, 'No pending deployments.');
  fillColumn('col-transit', buckets.transit, 'No units in transit right now.');
  fillColumn('col-completed', buckets.completed, 'No completed trips recorded.');
  fillColumn('col-issues', buckets.issues, 'All routes operating smoothly.');
}

function setCount(id, n) { 
  const el = document.getElementById(id); 
  if (el) el.textContent = n; 
}

function fillColumn(colId, list, emptyText) {
  const col = document.getElementById(colId);
  if (!col) return;
  
  if (list.length === 0) {
    col.innerHTML = `
      <div class="p-6 text-center text-slate-400 text-xs font-medium border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
        <i class="bi bi-inbox text-xl block mb-1 text-slate-300"></i>
        <span>${escapeHtml(emptyText)}</span>
      </div>`;
    return;
  }
  
  col.innerHTML = list.map(cardHtml).join('');
}

function cardHtml(t) {
  const hasIssue = incidentTripIds.has(t.id);
  const isCancelled = t.status === 'cancelled';
  
  return `
    <div class="kanban-card bg-white border border-slate-200/80 rounded-2xl p-4 cursor-pointer shadow-sm relative group" onclick="openTripActions('${t.id}')">
      <div class="flex items-center justify-between mb-2">
        <span class="font-mono text-[11px] bg-slate-100 font-bold text-slate-800 px-2 py-0.5 rounded-lg border border-slate-200">
          ${t.vehicle ? escapeHtml(t.vehicle.plate_number) : 'Unassigned Unit'}
        </span>
        ${hasIssue ? '<span class="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200/60"><i class="bi bi-exclamation-triangle-fill"></i> Incident</span>' : ''}
        ${isCancelled && !hasIssue ? '<span class="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">Cancelled</span>' : ''}
      </div>

      <div class="text-xs font-bold text-slate-900 mb-2 flex items-center gap-1.5 truncate">
        <span class="truncate">${escapeHtml(t.origin || 'Base')}</span>
        <i class="bi bi-arrow-right text-slate-400 text-[10px]"></i>
        <span class="text-teal-700 truncate">${escapeHtml(t.destination || 'Target')}</span>
      </div>

      <div class="flex items-center gap-2 pt-2 border-t border-slate-100">
        <img alt="Driver avatar" class="w-6 h-6 rounded-full object-cover border border-slate-200" src="${avatarDataUri(t.driver?.full_name)}"/>
        <span class="text-[11px] text-slate-700 font-semibold truncate">${t.driver ? escapeHtml(t.driver.full_name || 'Driver') : 'Unassigned'}</span>
      </div>

      <div class="text-[10px] text-slate-400 mt-2 flex items-center justify-between">
        <span>${t.scheduled_at ? formatDate(t.scheduled_at) : 'Immediate'}</span>
        <span class="text-brand-blue font-semibold group-hover:underline">Manage <i class="bi bi-chevron-right text-[9px]"></i></span>
      </div>
    </div>`;
}

window.openTripActions = function(tripId) {
  const trip = trips.find(t => t.id === tripId);
  if (!trip) return;

  const modal = document.getElementById('trip-actions-modal');
  document.getElementById('trip-actions-title').textContent = `${trip.origin || 'Base'} → ${trip.destination || 'Target'}`;
  const buttonsEl = document.getElementById('trip-actions-buttons');

  const actions = [];
  if (trip.status === 'pending') {
    actions.push({ label: 'Start Trip (In Transit)', next: 'in_progress', icon: 'bi-play-circle-fill', cls: 'bg-teal-600 hover:bg-teal-700 text-white' });
    actions.push({ label: 'Cancel Trip', next: 'cancelled', icon: 'bi-x-circle', cls: 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/60' });
  } else if (trip.status === 'in_progress') {
    actions.push({ label: 'Mark Trip Completed', next: 'completed', icon: 'bi-check-circle-fill', cls: 'bg-emerald-600 hover:bg-emerald-700 text-white' });
    actions.push({ label: 'Report Incident / Halt', next: 'cancelled', icon: 'bi-exclamation-octagon', cls: 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/60' });
  } else if (trip.status === 'cancelled') {
    actions.push({ label: 'Reopen Deployment as Pending', next: 'pending', icon: 'bi-arrow-clockwise', cls: 'bg-teal-600 hover:bg-teal-700 text-white' });
  }

  buttonsEl.innerHTML = actions.length
    ? actions.map(a => `
        <button onclick="updateTripStatus('${trip.id}', '${a.next}')" class="w-full px-4 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition ${a.cls}">
          <i class="bi ${a.icon}"></i>
          <span>${a.label}</span>
        </button>`).join('')
    : `<p class="text-xs text-slate-500 text-center py-2">Trip is marked as completed.</p>`;

  modal.classList.remove('hidden');
};

window.closeActionsModal = function() {
  document.getElementById('trip-actions-modal')?.classList.add('hidden');
};

window.updateTripStatus = async function(tripId, next) {
  const payload = { status: next };
  if (next === 'in_progress') payload.started_at = new Date().toISOString();
  if (next === 'completed') payload.completed_at = new Date().toISOString();

  const { error } = await supabase.from('trips').update(payload).eq('id', tripId);
  if (error) { 
    showToast(error.message, 'error'); 
    return; 
  }
  
  showToast('Trip stage updated.', 'success');
  closeActionsModal();
  await loadTrips();
};

window.openCreateModal = function() {
  document.getElementById('trip-modal')?.classList.remove('hidden');
};

window.closeCreateModal = function() {
  document.getElementById('trip-modal')?.classList.add('hidden');
  document.getElementById('trip-form')?.reset();
};

async function onCreateSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('trip-save-btn');
  const original = btn.textContent;
  
  btn.disabled = true; 
  btn.textContent = 'Dispatching...';

  const profile = await getUserProfile();
  const payload = {
    organization_id: orgId,
    origin: document.getElementById('trip-origin').value.trim(),
    destination: document.getElementById('trip-destination').value.trim(),
    vehicle_id: document.getElementById('trip-vehicle').value || null,
    driver_id: document.getElementById('trip-driver').value || null,
    scheduled_at: document.getElementById('trip-scheduled').value || null,
    notes: document.getElementById('trip-notes').value.trim() || null,
    status: 'pending',
    created_by: profile?.id || null,
  };

  if (!payload.origin || !payload.destination || !payload.vehicle_id || !payload.driver_id) {
    showToast('Please fill all required fields.', 'error');
    btn.disabled = false; 
    btn.textContent = original;
    return;
  }

  const { error } = await supabase.from('trips').insert(payload);
  btn.disabled = false; 
  btn.textContent = original;

  if (error) { 
    showToast(error.message, 'error'); 
    return; 
  }

  showToast('Trip created and dispatched.', 'success');
  closeCreateModal();
  await loadTrips();
}

document.getElementById('logout-btn')?.addEventListener('click', () => {
  if (confirm('Sign out from Dispatch Console?')) performLogout();
});