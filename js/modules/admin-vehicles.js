/**
 * ADMIN-VEHICLES.JS — Real-time vehicle registry, compliance tracking,
 * SinoTrack telematics hardware mapping, and driver assignments.
 */

import { supabase, getUserProfile, formatDate, daysUntil, escapeHtml, avatarDataUri, statusBadge } from '../config.js';
import { showToast } from '../auth.js';

const STATUS_MAP = {
  active:     { label: 'Operational', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200/60' },
  in_service: { label: 'In Service',  cls: 'bg-amber-50 text-amber-700 border border-amber-200/60' },
  flagged:    { label: 'Flagged',     cls: 'bg-rose-50 text-rose-700 border border-rose-200/60' },
  inactive:   { label: 'Inactive',    cls: 'bg-slate-100 text-slate-600 border border-slate-200' },
};

let orgId = null;
let vehicles = [];
let drivers = [];
let activeFilter = 'all';
let searchTerm = '';
let editingId = null;

const tbody = document.getElementById('vehicles-tbody');
if (tbody) init();

async function init() {
  const profile = await getUserProfile();
  if (!profile) return;
  
  orgId = profile.organization_id;

  // Hydrate header user information
  const headerName = document.getElementById('header-user-name');
  const headerAvatar = document.getElementById('header-avatar');
  if (headerName) headerName.textContent = profile.full_name || 'Fleet Administrator';
  if (headerAvatar && profile.full_name) {
    const initials = profile.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    headerAvatar.textContent = initials;
  }

  // Fetch true organization name
  if (orgId) {
    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', orgId)
      .single();
    
    if (org && document.getElementById('fc-org-name')) {
      document.getElementById('fc-org-name').textContent = org.name;
    }
  }

  await loadDrivers();
  await loadVehicles();
  setupVehiclesRealtime();

  // Search input event
  document.getElementById('vehicle-search')?.addEventListener('input', (e) => {
    searchTerm = e.target.value.trim().toLowerCase();
    render();
  });

  // Filter tabs
  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.getAttribute('data-filter');
      document.querySelectorAll('[data-filter]').forEach(b => {
        b.className = "px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-500 hover:bg-slate-50 whitespace-nowrap transition";
      });
      btn.className = "px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 text-brand-navy border border-slate-200/60 whitespace-nowrap transition";
      render();
    });
  });

  // Modal event bindings
  document.querySelectorAll('.fc-add-vehicle-btn').forEach(btn => btn.addEventListener('click', () => openModal()));
  document.getElementById('vehicle-modal-close')?.addEventListener('click', closeModal);
  document.getElementById('vehicle-cancel-btn')?.addEventListener('click', closeModal);
  document.getElementById('vehicle-form')?.addEventListener('submit', onSubmit);

  // Radio toggle for hardware tracking
  document.querySelectorAll('input[name="tracking_source"]').forEach(radio => {
    radio.addEventListener('change', (e) => updateTrackingUi(e.target.value));
  });

  tbody.addEventListener('click', onTableClick);
}

function updateTrackingUi(source) {
  const imeiInput = document.getElementById('vehicle-tracker-imei');
  const imeiStar = document.getElementById('imei-required-star');
  const labelDriver = document.getElementById('label-source-driver');
  const labelHardware = document.getElementById('label-source-hardware');

  if (source === 'hardware_gps') {
    imeiStar?.classList.remove('hidden');
    imeiInput?.setAttribute('placeholder', 'e.g. 7026176528 (SinoTrack ST-904L IMEI)');
    labelHardware?.classList.add('border-teal-500', 'bg-teal-50/40');
    labelDriver?.classList.remove('border-teal-500', 'bg-teal-50/40');
  } else {
    imeiStar?.classList.add('hidden');
    imeiInput?.setAttribute('placeholder', 'Optional IMEI if available');
    labelDriver?.classList.add('border-teal-500', 'bg-teal-50/40');
    labelHardware?.classList.remove('border-teal-500', 'bg-teal-50/40');
  }
}

async function loadDrivers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('organization_id', orgId)
    .eq('role', 'driver')
    .order('full_name');
    
  if (!error) drivers = data || [];
  
  const select = document.getElementById('vehicle-driver-select');
  if (select) {
    select.innerHTML = '<option value="">Unassigned</option>' +
      drivers.map(d => `<option value="${d.id}">${escapeHtml(d.full_name || 'Unnamed Driver')}</option>`).join('');
  }
}

window.loadVehicles = async function() {
  tbody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-slate-400 font-medium">Fetching fleet vehicles...</td></tr>`;
  
  // Safe fetch without strict profile relation lock
  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-rose-500 font-medium">Failed to load vehicles: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }
  
  // Map assigned driver names from driver cache
  const driverMap = {};
  drivers.forEach(d => { driverMap[d.id] = d; });

  vehicles = (data || []).map(v => ({
    ...v,
    assigned_driver: v.assigned_driver_id ? driverMap[v.assigned_driver_id] : null
  }));

  render();
};

function setupVehiclesRealtime() {
  if (!orgId) return;

  supabase.channel(`vehicles-registry-${orgId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles', filter: `organization_id=eq.${orgId}` }, () => {
      window.loadVehicles();
    })
    .subscribe();
}

function render() {
  updateCounts();

  let list = vehicles;
  if (activeFilter !== 'all') list = list.filter(v => v.status === activeFilter);
  if (searchTerm) {
    list = list.filter(v =>
      (v.plate_number || '').toLowerCase().includes(searchTerm) ||
      (v.name || '').toLowerCase().includes(searchTerm) ||
      (v.make || '').toLowerCase().includes(searchTerm) ||
      (v.model || '').toLowerCase().includes(searchTerm) ||
      (v.tracker_imei || '').toLowerCase().includes(searchTerm) ||
      (v.assigned_driver?.full_name || '').toLowerCase().includes(searchTerm)
    );
  }

  const countEl = document.getElementById('vehicles-showing-count');
  if (countEl) {
    countEl.textContent = `Showing ${list.length} of ${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'}`;
  }

  if (vehicles.length === 0) {
    tbody.innerHTML = emptyStateRow('No vehicles in fleet yet', 'Add your first vehicle unit to begin tracking live telematics and dispatch routes.');
    return;
  }
  
  if (list.length === 0) {
    tbody.innerHTML = emptyStateRow('No vehicles matched', 'Try refining your search keyword or selected status filter.');
    return;
  }

  tbody.innerHTML = list.map(rowHtml).join('');
}

function updateCounts() {
  const counts = { all: vehicles.length, active: 0, in_service: 0, flagged: 0 };
  vehicles.forEach(v => { if (counts[v.status] !== undefined) counts[v.status]++; });
  
  const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
  set('count-all', counts.all);
  set('count-active', counts.active);
  set('count-in_service', counts.in_service);
  set('count-flagged', counts.flagged);
}

function emptyStateRow(title, sub) {
  return `
    <tr>
      <td colspan="6" class="py-16 text-center">
        <div class="flex flex-col items-center gap-2 text-slate-400 max-w-sm mx-auto">
          <i class="bi bi-truck text-3xl text-slate-300"></i>
          <span class="text-xs font-bold text-slate-700">${escapeHtml(title)}</span>
          <span class="text-[11px] text-slate-400">${escapeHtml(sub)}</span>
        </div>
      </td>
    </tr>`;
}

function expiryCell(dateStr) {
  if (!dateStr) return `<span class="text-slate-400 italic text-[11px]">Not on file</span>`;
  
  const d = daysUntil(dateStr);
  let colorClass = 'text-emerald-600 font-bold', barClass = 'bg-emerald-500', label = `${d} days left`, width = Math.max(4, Math.min(100, (d / 180) * 100));
  
  if (d < 0) { 
    colorClass = 'text-rose-600 font-bold'; 
    barClass = 'bg-rose-500'; 
    label = 'Expired'; 
    width = 100; 
  } else if (d <= 30) { 
    colorClass = 'text-amber-600 font-bold'; 
    barClass = 'bg-amber-500'; 
    label = `${d} days (Expiring)`; 
    width = Math.max(8, width); 
  }
  
  return `
    <div class="flex flex-col gap-1 w-full max-w-[170px]">
      <div class="flex justify-between text-[11px]">
        <span class="text-slate-700 font-medium">${formatDate(dateStr)}</span>
        <span class="${colorClass}">${label}</span>
      </div>
      <div class="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
        <div class="h-full ${barClass} rounded-full" style="width:${width}%"></div>
      </div>
    </div>`;
}

function rowHtml(v) {
  const driverCell = v.assigned_driver
    ? `<div class="flex items-center gap-2">
        <img alt="Driver avatar" class="w-6 h-6 rounded-full object-cover border border-slate-200" src="${avatarDataUri(v.assigned_driver.full_name)}"/>
        <span class="text-slate-800 font-semibold">${escapeHtml(v.assigned_driver.full_name || 'Driver')}</span>
      </div>`
    : `<span class="text-slate-400 italic text-[11px]">Unassigned</span>`;

  // Telemetry Source Badge
  let telemetryCell = `
    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
      <i class="bi bi-phone"></i> Driver App
    </span>`;
  
  if (v.tracking_source === 'hardware_gps' || v.tracker_imei) {
    telemetryCell = `
      <div class="flex flex-col">
        <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-xl text-[11px] font-bold bg-teal-50 text-teal-700 border border-teal-200/80 w-fit">
          <i class="bi bi-broadcast text-teal-600"></i> SinoTrack GPS
        </span>
        <span class="font-mono text-[10px] text-slate-500 mt-0.5 font-bold pl-0.5">IMEI: ${escapeHtml(v.tracker_imei || 'Not Set')}</span>
      </div>`;
  }

  const displayName = v.name ? `<div class="text-[11px] font-bold text-slate-800">${escapeHtml(v.name)}</div>` : '';
  const vehicleSub = [v.make, v.model].filter(Boolean).join(' ') || v.vehicle_type || 'Fleet Unit';

  return `
    <tr class="hover:bg-slate-50/75 transition border-b border-slate-100 group" data-id="${v.id}">
      <td class="py-3.5 px-4">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 border border-slate-200/60 shrink-0">
            <i class="bi bi-truck text-base"></i>
          </div>
          <div>
            <div class="font-mono text-xs text-slate-900 bg-slate-100/80 px-2 py-0.5 rounded-lg border border-slate-200 inline-block font-bold tracking-wider mb-0.5">${escapeHtml(v.plate_number)}</div>
            ${displayName}
            <div class="text-slate-400 text-[11px]">${escapeHtml(vehicleSub)} ${v.year ? `(${v.year})` : ''}</div>
          </div>
        </div>
      </td>
      <td class="py-3.5 px-4">${statusBadge(v.status, STATUS_MAP)}</td>
      <td class="py-3.5 px-4">${driverCell}</td>
      <td class="py-3.5 px-4">${telemetryCell}</td>
      <td class="py-3.5 px-4">${expiryCell(v.roadworthiness_expiry)}</td>
      <td class="py-3.5 px-4 text-right">
        <div class="inline-flex items-center gap-1">
          <button class="text-slate-400 hover:text-brand-navy p-1.5 rounded-lg hover:bg-slate-100 transition" data-action="edit" title="Edit Vehicle Details">
            <i class="bi bi-pencil-square text-sm"></i>
          </button>
          <button class="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-slate-100 transition" data-action="delete" title="Remove Vehicle">
            <i class="bi bi-trash3 text-sm"></i>
          </button>
        </div>
      </td>
    </tr>`;
}

function onTableClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  
  const tr = btn.closest('tr[data-id]');
  const id = tr?.getAttribute('data-id');
  const vehicle = vehicles.find(v => v.id === id);
  
  if (!vehicle) return;
  if (btn.dataset.action === 'edit') openModal(vehicle);
  if (btn.dataset.action === 'delete') deleteVehicle(vehicle);
}

async function deleteVehicle(vehicle) {
  if (!confirm(`Are you sure you want to remove ${vehicle.plate_number} from your fleet?`)) return;
  
  const { error } = await supabase.from('vehicles').delete().eq('id', vehicle.id);
  if (error) { 
    showToast(`Could not delete vehicle: ${error.message}`, 'error'); 
    return; 
  }
  
  vehicles = vehicles.filter(v => v.id !== vehicle.id);
  render();
  showToast(`${vehicle.plate_number} has been removed.`, 'success');
}

window.openModal = function(vehicle = null) {
  editingId = vehicle?.id || null;
  const modal = document.getElementById('vehicle-modal');
  if (!modal) return;
  
  document.getElementById('vehicle-modal-title').textContent = vehicle ? 'Edit Vehicle Specifications' : 'Register Vehicle';
  document.getElementById('vehicle-name').value = vehicle?.name || '';
  document.getElementById('vehicle-plate').value = vehicle?.plate_number || '';
  document.getElementById('vehicle-make').value = vehicle?.make || '';
  document.getElementById('vehicle-model').value = vehicle?.model || '';
  document.getElementById('vehicle-year').value = vehicle?.year || '';
  document.getElementById('vehicle-type').value = vehicle?.vehicle_type || 'truck';
  document.getElementById('vehicle-capacity').value = vehicle?.capacity_kg || '';
  document.getElementById('vehicle-status').value = vehicle?.status || 'active';
  document.getElementById('vehicle-roadworthiness').value = vehicle?.roadworthiness_expiry || '';
  document.getElementById('vehicle-insurance').value = vehicle?.insurance_expiry || '';
  document.getElementById('vehicle-driver-select').value = vehicle?.assigned_driver_id || '';
  
  const trackingSource = vehicle?.tracking_source || (vehicle?.tracker_imei ? 'hardware_gps' : 'driver_app');
  if (trackingSource === 'hardware_gps') {
    document.getElementById('source-hardware').checked = true;
  } else {
    document.getElementById('source-driver').checked = true;
  }
  document.getElementById('vehicle-tracker-imei').value = vehicle?.tracker_imei || '';
  updateTrackingUi(trackingSource);
  
  modal.classList.remove('hidden');
};

window.closeModal = function() {
  document.getElementById('vehicle-modal')?.classList.add('hidden');
  editingId = null;
};

async function onSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('vehicle-save-btn');
  const original = btn.textContent;
  
  btn.disabled = true; 
  btn.textContent = 'Saving...';

  const tracking_source = document.querySelector('input[name="tracking_source"]:checked')?.value || 'driver_app';
  const tracker_imei = document.getElementById('vehicle-tracker-imei').value.trim() || null;

  if (tracking_source === 'hardware_gps' && !tracker_imei) {
    showToast('Please enter the SinoTrack Device ID / IMEI for hardware tracking.', 'error');
    btn.disabled = false;
    btn.textContent = original;
    return;
  }

  const payload = {
    organization_id: orgId,
    name: document.getElementById('vehicle-name').value.trim() || null,
    plate_number: document.getElementById('vehicle-plate').value.trim().toUpperCase(),
    make: document.getElementById('vehicle-make').value.trim() || null,
    model: document.getElementById('vehicle-model').value.trim() || null,
    year: document.getElementById('vehicle-year').value ? Number(document.getElementById('vehicle-year').value) : null,
    vehicle_type: document.getElementById('vehicle-type').value,
    capacity_kg: document.getElementById('vehicle-capacity').value ? Number(document.getElementById('vehicle-capacity').value) : null,
    status: document.getElementById('vehicle-status').value,
    roadworthiness_expiry: document.getElementById('vehicle-roadworthiness').value || null,
    insurance_expiry: document.getElementById('vehicle-insurance').value || null,
    assigned_driver_id: document.getElementById('vehicle-driver-select').value || null,
    tracking_source,
    tracker_imei
  };

  if (!payload.plate_number) {
    showToast('Plate number is required.', 'error');
    btn.disabled = false; 
    btn.textContent = original;
    return;
  }

  const query = editingId
    ? supabase.from('vehicles').update(payload).eq('id', editingId)
    : supabase.from('vehicles').insert(payload);

  const { error } = await query;
  btn.disabled = false; 
  btn.textContent = original;

  if (error) {
    if (error.code === '23505') {
      const msg = error.message.includes('tracker_imei')
        ? 'This Tracker IMEI is already assigned to another vehicle.'
        : 'A vehicle with this plate number is already registered.';
      showToast(msg, 'error');
    } else {
      showToast(error.message, 'error');
    }
    return;
  }

  showToast(editingId ? 'Vehicle specifications updated.' : 'New vehicle added to fleet.', 'success');
  closeModal();
  await window.loadVehicles();
}