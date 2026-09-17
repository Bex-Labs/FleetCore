/**
 * BEX-RADAR.JS — Global telematics telemetry, cross-tenant unit tracking & Admin Broadcast.
 */
import { supabase, getUserProfile, escapeHtml } from '../config.js';
import { showToast, performLogout } from '../auth.js';

let map = null;
let markers = {};
let activeTrips = [];
let orgs = [];

const mapEl = document.getElementById('radar-map');
if (mapEl) initRadar();

export async function initRadar() {
  const profile = await getUserProfile();
  if (!profile) return;

  const fullName = profile.full_name || 'Bex Administrator';
  const initials = fullName.split(/\s+/).map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'BX';

  const headerName = document.getElementById('header-user-name');
  const headerAvatar = document.getElementById('header-avatar');
  if (headerName) headerName.textContent = fullName;
  if (headerAvatar) headerAvatar.textContent = initials;

  initLeafletMap();
  await loadOrganizations();
  await loadRadarFleet();

  document.getElementById('radar-org-filter')?.addEventListener('change', () => filterRadarPins());

  // Broadcast Modal Event Listeners
  const bcModal = document.getElementById('broadcast-modal');
  document.getElementById('btn-open-broadcast')?.addEventListener('click', () => bcModal?.classList.remove('hidden'));
  document.getElementById('broadcast-modal-close')?.addEventListener('click', () => bcModal?.classList.add('hidden'));
  document.getElementById('broadcast-cancel-btn')?.addEventListener('click', () => bcModal?.classList.add('hidden'));
  document.getElementById('broadcast-form')?.addEventListener('submit', onTransmitDirective);
}

function initLeafletMap() {
  if (map || typeof L === 'undefined') return;

  map = L.map('radar-map', { zoomControl: true }).setView([9.0820, 8.6753], 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
}

async function loadOrganizations() {
  const { data } = await supabase.from('organizations').select('id, name, company_code').order('name');
  orgs = data || [];
  
  const filterSelect = document.getElementById('radar-org-filter');
  const targetSelect = document.getElementById('bc-org-target');

  if (filterSelect && orgs.length > 0) {
    filterSelect.innerHTML = `<option value="all">All Fleets & Tenants</option>` +
      orgs.map(o => `<option value="${o.id}">${escapeHtml(o.name)} (${escapeHtml(o.company_code || 'TC')})</option>`).join('');
  }

  if (targetSelect && orgs.length > 0) {
    targetSelect.innerHTML = `<option value="all">All Registered Tenants (Global Broadcast)</option>` +
      orgs.map(o => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('');
  }
}

window.loadRadarFleet = async function() {
  const feed = document.getElementById('radar-feed-list');
  const countBadge = document.getElementById('radar-live-count');

  try {
    // FIX: Explicitly specify foreign key relation (!driver_id and !vehicle_id) to avoid ambiguous embedding error
    const { data, error } = await supabase
      .from('trips')
      .select(`
        *,
        vehicle:vehicles!vehicle_id(plate_number, make, model),
        driver:profiles!driver_id(full_name, phone_number),
        organization:organizations!organization_id(name, company_code)
      `)
      .eq('status', 'in_progress');

    if (error) throw error;
    activeTrips = data || [];

    if (countBadge) countBadge.textContent = `${activeTrips.length} Active`;
    renderRadarFeed(activeTrips);
    filterRadarPins();

  } catch (err) {
    if (feed) feed.innerHTML = `<div class="p-6 text-center text-rose-500 text-xs">Error querying telemetry: ${escapeHtml(err.message)}</div>`;
  }
};

function renderRadarFeed(tripsToRender) {
  const feed = document.getElementById('radar-feed-list');
  if (!feed) return;

  if (tripsToRender.length === 0) {
    feed.innerHTML = `<div class="p-8 text-center text-slate-400 text-xs">No vehicles currently in transit across the platform.</div>`;
    return;
  }

  feed.innerHTML = tripsToRender.map(t => `
    <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl hover:border-teal-500 cursor-pointer transition" onclick="zoomToVehicle('${t.id}')">
      <div class="flex items-center justify-between mb-1.5">
        <span class="font-mono font-bold text-slate-900 text-xs bg-white px-2 py-0.5 rounded border border-slate-200">
          ${t.vehicle ? escapeHtml(t.vehicle.plate_number) : 'Unit'}
        </span>
        <span class="text-[10px] font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-200/60">
          ${escapeHtml(t.organization?.company_code || 'TENANT')}
        </span>
      </div>
      <div class="text-xs font-bold text-slate-800 truncate mb-1">
        ${escapeHtml(t.origin || 'Base')} → ${escapeHtml(t.destination || 'Target')}
      </div>
      <div class="text-[11px] text-slate-500 flex justify-between">
        <span>${escapeHtml(t.driver?.full_name || 'Driver')}</span>
        <span class="text-emerald-600 font-bold">In Transit</span>
      </div>
    </div>`).join('');
}

function filterRadarPins() {
  if (!map) return;

  Object.values(markers).forEach(m => map.removeLayer(m));
  markers = {};

  const orgFilter = document.getElementById('radar-org-filter')?.value || 'all';
  const filtered = orgFilter === 'all' 
    ? activeTrips 
    : activeTrips.filter(t => t.organization_id === orgFilter);

  renderRadarFeed(filtered);

  const bounds = [];
  filtered.forEach((t, idx) => {
    const lat = 9.0820 + ((idx % 5) - 2) * 0.45;
    const lng = 8.6753 + ((idx % 4) - 2) * 0.55;
    bounds.push([lat, lng]);

    const pinIcon = L.divIcon({
      className: 'radar-unit-pin',
      html: `<div class="w-7 h-7 rounded-xl bg-slate-950 text-teal-400 font-black text-xs border-2 border-teal-400 shadow-xl flex items-center justify-center"><i class="bi bi-truck"></i></div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    const m = L.marker([lat, lng], { icon: pinIcon }).addTo(map).bindPopup(`
      <div class="p-1 space-y-1">
        <span class="font-bold text-slate-900 block text-xs">${t.vehicle ? escapeHtml(t.vehicle.plate_number) : 'Vehicle'}</span>
        <span class="text-[10px] text-teal-700 font-bold block">${escapeHtml(t.organization?.name || 'Tenant')}</span>
        <span class="text-[11px] text-slate-600 block">${escapeHtml(t.origin || 'Origin')} → ${escapeHtml(t.destination || 'Target')}</span>
        <span class="text-[10px] text-slate-500 block">Driver: ${escapeHtml(t.driver?.full_name || 'Unassigned')}</span>
      </div>
    `);

    markers[t.id] = m;
  });

  if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
  }
}

window.zoomToVehicle = function(tripId) {
  const m = markers[tripId];
  if (m && map) {
    map.setView(m.getLatLng(), 13);
    m.openPopup();
  }
};

/**
 * Bex Admin: Broadcast Directive Handler targeting Org Admins & Managers
 */
async function onTransmitDirective(e) {
  e.preventDefault();
  const btn = document.getElementById('broadcast-submit-btn');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Broadcasting...';

  const orgTarget = document.getElementById('bc-org-target').value;
  const roleTarget = document.getElementById('bc-role-target').value;
  const title = document.getElementById('bc-title').value.trim();
  const message = document.getElementById('bc-message').value.trim();

  try {
    const orgIds = orgTarget === 'all' ? orgs.map(o => o.id) : [orgTarget];

    // Insert management notification rows
    const inserts = orgIds.map(oId => ({
      organization_id: oId,
      title: `[DIRECTIVE] ${title}`,
      message: message,
      target_role: roleTarget,
      is_broadcast: true,
      created_at: new Date().toISOString()
    }));

    await supabase.from('notifications').insert(inserts);

    // Transmit instant broadcast event via Supabase Realtime channel
    await supabase.channel('global-fleet-broadcast').send({
      type: 'broadcast',
      event: 'urgent-alert',
      payload: { message: `[DIRECTIVE] ${title}: ${message}`, role: roleTarget }
    });

    showToast('Platform directive successfully transmitted to management.', 'success');
    document.getElementById('broadcast-modal').classList.add('hidden');
    document.getElementById('broadcast-form').reset();
  } catch (err) {
    showToast(`Broadcast failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

document.getElementById('logout-btn')?.addEventListener('click', () => {
  if (confirm('Sign out from Bex Admin Console?')) performLogout();
});