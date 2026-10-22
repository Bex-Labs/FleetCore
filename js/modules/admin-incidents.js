/**
 * ADMIN-INCIDENTS.JS — Crisis Command Center, interactive GPS telematics map,
 * category filters, emergency report creation, and incident resolution workflow.
 */

import { supabase, getUserProfile, formatDate, timeAgo, escapeHtml, avatarDataUri, createTileLayer } from '../config.js';
import { showToast } from '../auth.js';

let currentOrgId = null;
let leafletMap = null;
let incidentMarkers = {};
let incidents = [];
let activeFilter = 'all';
let selectedIncidentId = null;
let vehicles = [];
let drivers = [];

if (document.getElementById('crisis-radar-map')) {
  initCrisisCenter();
}

export async function initCrisisCenter() {
  initRadarMap();

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

  // Fetch true organization name
  if (currentOrgId) {
    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', currentOrgId)
      .single();

    if (org && document.getElementById('fc-org-name')) {
      document.getElementById('fc-org-name').textContent = org.name;
    }
  }

  // Bind filter buttons
  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.getAttribute('data-filter');
      document.querySelectorAll('[data-filter]').forEach(b => {
        b.className = "px-3 py-1 rounded-xl font-semibold text-slate-500 hover:bg-slate-50 transition";
      });
      btn.className = "px-3 py-1 rounded-xl font-bold bg-slate-100 text-brand-navy border border-slate-200 transition";
      renderIncidentFeed();
    });
  });

  await loadDropdownData();
  await loadIncidents();
  setupRealtimeSosChannel(currentOrgId);
}
window.initCrisisCenter = initCrisisCenter;

function initRadarMap() {
  const mapEl = document.getElementById('crisis-radar-map');
  if (!mapEl || leafletMap) return;

  if (typeof L === 'undefined') return;

  // Default to central Nigeria / West Africa
  leafletMap = L.map('crisis-radar-map', {
    zoomControl: true,
    attributionControl: false,
  }).setView([9.0820, 8.6753], 6);

  const tileLayer = createTileLayer();
  if (tileLayer) tileLayer.addTo(leafletMap);

  setTimeout(() => {
    if (leafletMap) leafletMap.invalidateSize();
  }, 250);
}

async function loadDropdownData() {
  if (!currentOrgId) return;

  const [vRes, dRes] = await Promise.all([
    supabase.from('vehicles').select('id, plate_number, make, model').eq('organization_id', currentOrgId).order('plate_number'),
    supabase.from('profiles').select('id, full_name').eq('organization_id', currentOrgId).eq('role', 'driver').order('full_name'),
  ]);

  vehicles = vRes.data || [];
  drivers = dRes.data || [];

  const vSelect = document.getElementById('inc-vehicle');
  if (vSelect) {
    vSelect.innerHTML = vehicles.length
      ? vehicles.map(v => `<option value="${v.id}">${escapeHtml(v.plate_number)} (${escapeHtml([v.make, v.model].filter(Boolean).join(' ') || 'Vehicle')})</option>`).join('')
      : `<option value="">No vehicles available</option>`;
  }

  const dSelect = document.getElementById('inc-driver');
  if (dSelect) {
    dSelect.innerHTML = '<option value="">Unassigned</option>' +
      drivers.map(d => `<option value="${d.id}">${escapeHtml(d.full_name)}</option>`).join('');
  }
}

window.loadIncidents = async function() {
  const feed = document.getElementById('incidents-feed-list');
  if (!feed || !currentOrgId) return;

  feed.innerHTML = `<div class="p-8 text-center text-slate-400 text-xs font-medium">Fetching emergency telematics...</div>`;

  const { data, error } = await supabase
    .from('incidents')
    .select('*, vehicle:vehicles(id, plate_number, make, model), driver:profiles!driver_id(id, full_name, phone_number)')
    .eq('organization_id', currentOrgId)
    .order('created_at', { ascending: false });

  if (error) {
    const { data: fallbackData } = await supabase
      .from('incidents')
      .select('*, vehicle:vehicles(id, plate_number, make, model)')
      .eq('organization_id', currentOrgId)
      .order('created_at', { ascending: false });

    incidents = fallbackData || [];
  } else {
    incidents = data || [];
  }

  updateCategoryCards();
  renderIncidentFeed();
  renderRadarMapBeacons();
};

function updateCategoryCards() {
  const sosCount = incidents.filter(i => (i.incident_type === 'sos' || i.severity === 'critical') && i.status !== 'resolved' && i.status !== 'closed').length;
  const healthCount = incidents.filter(i => i.incident_type === 'health' && i.status !== 'resolved' && i.status !== 'closed').length;
  const roadCount = incidents.filter(i => (i.incident_type === 'road' || i.incident_type === 'mechanical') && i.status !== 'resolved' && i.status !== 'closed').length;
  const resolvedCount = incidents.filter(i => i.status === 'resolved' || i.status === 'closed').length;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('kpi-sos-count', sosCount);
  set('kpi-health-count', healthCount);
  set('kpi-road-count', roadCount);
  set('kpi-resolved-count', resolvedCount);

  const sosStatus = document.getElementById('kpi-sos-status');
  if (sosStatus) {
    sosStatus.textContent = sosCount > 0 ? `${sosCount} urgent active panic triggers` : 'No active panic triggers';
  }

  const feedTotal = document.getElementById('incident-feed-total');
  if (feedTotal) feedTotal.textContent = `${incidents.length} Reports`;
}

function renderIncidentFeed() {
  const feed = document.getElementById('incidents-feed-list');
  if (!feed) return;

  let filtered = incidents;

  if (activeFilter === 'sos') {
    filtered = incidents.filter(i => (i.incident_type === 'sos' || i.severity === 'critical') && i.status !== 'resolved');
  } else if (activeFilter === 'health') {
    filtered = incidents.filter(i => i.incident_type === 'health' && i.status !== 'resolved');
  } else if (activeFilter === 'road') {
    filtered = incidents.filter(i => (i.incident_type === 'road' || i.incident_type === 'mechanical') && i.status !== 'resolved');
  } else if (activeFilter === 'resolved') {
    filtered = incidents.filter(i => i.status === 'resolved' || i.status === 'closed');
  }

  if (filtered.length === 0) {
    feed.innerHTML = `
      <div class="p-8 text-center text-slate-400 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
        <i class="bi bi-shield-check text-2xl text-emerald-500 block mb-1"></i>
        <span class="text-xs font-bold text-slate-700">No reports in this category</span>
      </div>`;
    return;
  }

  feed.innerHTML = filtered.map(item => {
    const isSos = (item.incident_type || '').toLowerCase().includes('sos') || item.severity === 'critical';
    const isHealth = (item.incident_type || '').toLowerCase().includes('health') || (item.incident_type || '').toLowerCase().includes('medical');
    const isResolved = item.status === 'resolved' || item.status === 'closed';

    const cardBorder = isResolved 
      ? 'border-slate-200 bg-white' 
      : isSos 
      ? 'border-rose-300 bg-rose-50/20' 
      : isHealth 
      ? 'border-purple-300 bg-purple-50/20' 
      : 'border-amber-300 bg-amber-50/20';

    const iconCls = isResolved 
      ? 'bg-slate-100 text-slate-500' 
      : isSos 
      ? 'bg-rose-100 text-rose-700' 
      : isHealth 
      ? 'bg-purple-100 text-purple-700' 
      : 'bg-amber-100 text-amber-700';

    const icon = isHealth 
      ? 'bi-heart-pulse-fill' 
      : isSos 
      ? 'bi-exclamation-octagon-fill' 
      : 'bi-wrench-adjustable';

    const typeLabel = isHealth 
      ? 'Health Emergency' 
      : isSos 
      ? 'Panic SOS Trigger' 
      : item.incident_type === 'road' 
      ? 'Road Hazard' 
      : item.incident_type === 'mechanical' 
      ? 'Mechanical Breakdown' 
      : 'Incident Report';

    const hasCoords = (item.latitude || item.lat) && (item.longitude || item.lng);

    return `
      <div class="p-4 rounded-2xl border ${cardBorder} shadow-sm transition hover:shadow-md flex flex-col gap-2.5">
        
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-xl ${iconCls} flex items-center justify-center text-sm shrink-0">
              <i class="bi bi-heart-pulse-fill"></i>
            </div>
            <div>
              <div class="text-xs font-bold text-slate-900 leading-tight">${escapeHtml(typeLabel)}</div>
              <div class="text-[10px] text-slate-400 mt-0.5">${timeAgo(item.created_at)} · ${formatDate(item.created_at)}</div>
            </div>
          </div>
          
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${isResolved ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}">
            ${escapeHtml(item.status || 'open')}
          </span>
        </div>

        <p class="text-xs text-slate-700 font-medium">${escapeHtml(item.description || item.details || 'No message provided.')}</p>

        <div class="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
          <div class="flex items-center gap-2">
            <span class="font-mono text-[11px] font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
              ${item.vehicle ? escapeHtml(item.vehicle.plate_number) : 'Vehicle Unlinked'}
            </span>
            ${hasCoords ? `
              <span class="text-[10px] font-mono text-teal-700 font-bold bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200/60 flex items-center gap-1">
                <i class="bi bi-geo-alt-fill text-[9px]"></i> GPS Locked
              </span>` : `<span class="text-[10px] text-slate-400 italic">No GPS</span>`}
          </div>

          <div class="flex items-center gap-1.5">
            ${hasCoords ? `
              <button onclick="trackIncidentLocation('${item.id}')" class="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-[11px] rounded-lg border border-blue-200/60 transition flex items-center gap-1">
                <i class="bi bi-crosshair"></i> Track
              </button>` : ''}

            ${!isResolved ? `
              <button onclick="openResolveModal('${item.id}')" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] rounded-lg shadow-sm transition flex items-center gap-1">
                <i class="bi bi-check-lg"></i> Resolve
              </button>` : `
              <span class="text-emerald-600 font-bold text-[11px] flex items-center gap-1">
                <i class="bi bi-check-circle-fill"></i> Cleared
              </span>`}
          </div>
        </div>

      </div>`;
  }).join('');
}

function renderRadarMapBeacons() {
  if (!leafletMap) return;

  // Clear existing markers
  Object.keys(incidentMarkers).forEach(id => {
    incidentMarkers[id].remove();
    delete incidentMarkers[id];
  });

  const bounds = [];

  incidents.forEach(item => {
    const lat = Number(item.latitude || item.lat);
    const lng = Number(item.longitude || item.lng);

    if (!lat || !lng || isNaN(lat) || isNaN(lng)) return;

    const isSos = (item.incident_type || '').toLowerCase().includes('sos') || item.severity === 'critical';
    const isHealth = (item.incident_type || '').toLowerCase().includes('health') || (item.incident_type || '').toLowerCase().includes('medical');
    const isResolved = item.status === 'resolved' || item.status === 'closed';

    const beaconClass = isResolved ? 'bg-emerald-500' : isSos ? 'pulse-danger-beacon' : isHealth ? 'pulse-health-beacon' : 'pulse-amber-beacon';

    const customIcon = L.divIcon({
      className: 'custom-beacon-icon',
      html: `<div class="${beaconClass}"></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });

    const marker = L.marker([lat, lng], { icon: customIcon }).addTo(leafletMap);
    marker.bindPopup(`
      <div class="font-sans text-xs p-1">
        <strong class="${isSos ? 'text-rose-600' : isHealth ? 'text-purple-700' : 'text-slate-900'} font-bold">
          ${escapeHtml((item.incident_type || 'Emergency').toUpperCase())}
        </strong>
        <div class="text-slate-600 text-[11px] mt-0.5">${escapeHtml(item.description || 'Terminal emergency report')}</div>
        <div class="mt-1 font-mono text-[10px] text-slate-500">Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}</div>
      </div>
    `);

    incidentMarkers[item.id] = marker;
    bounds.push([lat, lng]);
  });

  if (bounds.length > 0) {
    leafletMap.fitBounds(bounds, { padding: [50, 50], maxZoom: 13 });
  }
}

window.trackIncidentLocation = function(incidentId) {
  const inc = incidents.find(i => i.id === incidentId);
  if (!inc || !leafletMap) return;

  const lat = Number(inc.latitude || inc.lat);
  const lng = Number(inc.longitude || inc.lng);

  if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
    leafletMap.flyTo([lat, lng], 16, { animate: true, duration: 1.5 });

    if (incidentMarkers[incidentId]) {
      setTimeout(() => {
        incidentMarkers[incidentId].openPopup();
      }, 1500);
    }

    const statusLabel = document.getElementById('map-target-status');
    if (statusLabel) {
      statusLabel.innerHTML = `<span class="text-rose-600 font-bold">Tracking Alert Location:</span> ${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;
    }
  } else {
    showToast('No GPS coordinates attached to this incident.', 'info');
  }
};

window.openNewIncidentModal = function() {
  document.getElementById('new-incident-modal')?.classList.remove('hidden');
};

window.closeNewIncidentModal = function() {
  document.getElementById('new-incident-modal')?.classList.add('hidden');
  document.getElementById('new-incident-form')?.reset();
};

window.handleCreateIncident = async function(e) {
  e.preventDefault();
  const btn = document.getElementById('inc-save-btn');
  const original = btn.textContent;

  const incident_type = document.getElementById('inc-type').value;
  const vehicle_id = document.getElementById('inc-vehicle').value;
  const driver_id = document.getElementById('inc-driver').value || null;
  const latitude = document.getElementById('inc-lat').value ? Number(document.getElementById('inc-lat').value) : null;
  const longitude = document.getElementById('inc-lng').value ? Number(document.getElementById('inc-lng').value) : null;
  const description = document.getElementById('inc-desc').value.trim();

  if (!vehicle_id || !description) {
    showToast('Vehicle and description are required.', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Broadcasting...';

  const profile = await getUserProfile();
  const payload = {
    organization_id: currentOrgId,
    vehicle_id,
    driver_id,
    incident_type,
    severity: incident_type === 'sos' ? 'critical' : incident_type === 'health' ? 'high' : 'medium',
    latitude,
    longitude,
    description,
    status: 'open',
    reporter_id: profile?.id || null,
  };

  const { error } = await supabase.from('incidents').insert(payload);
  btn.disabled = false;
  btn.textContent = original;

  if (error) {
    showToast(error.message, 'error');
    return;
  }

  showToast('Emergency alert broadcasted to telematics radar.', 'success');
  window.closeNewIncidentModal();
  await window.loadIncidents();
};

window.openResolveModal = function(incidentId) {
  selectedIncidentId = incidentId;
  document.getElementById('resolve-modal')?.classList.remove('hidden');
};

window.closeResolveModal = function() {
  document.getElementById('resolve-modal')?.classList.add('hidden');
  document.getElementById('resolve-form')?.reset();
  selectedIncidentId = null;
};

window.handleResolveIncident = async function(e) {
  e.preventDefault();
  if (!selectedIncidentId) return;

  const btn = document.getElementById('resolve-save-btn');
  const original = btn.textContent;

  const status = document.getElementById('resolve-status').value;
  const notes = document.getElementById('resolve-notes').value.trim();

  btn.disabled = true;
  btn.textContent = 'Resolving...';

  try {
    const { error } = await supabase
      .from('incidents')
      .update({
        status: status,
        resolution_notes: notes,
        resolved_at: status === 'resolved' ? new Date().toISOString() : null,
      })
      .eq('id', selectedIncidentId);

    if (error) throw error;

    showToast('Crisis ticket marked as resolved and cleared.', 'success');
    window.closeResolveModal();
    await window.loadIncidents();
  } catch (err) {
    showToast(err.message || 'Failed to resolve incident.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
};

function setupRealtimeSosChannel(orgId) {
  if (!orgId) return;

  supabase.channel(`fleet-crisis-live-${orgId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'incidents', filter: `organization_id=eq.${orgId}` }, (payload) => {
      const inc = payload.new;
      if (inc) {
        showToast(`🚨 CRISIS ALERT: ${inc.incident_type || 'SOS'} broadcast received!`, 'error', 8000);
      }
      window.loadIncidents();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'incidents', filter: `organization_id=eq.${orgId}` }, () => {
      window.loadIncidents();
    })
    .subscribe();
}