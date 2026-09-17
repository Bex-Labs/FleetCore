/**
 * MAINTENANCE-VEHICLE-HEALTH.JS — Fleet health status, roadworthiness audits & CSV/PDF export.
 */
import { supabase, getUserProfile, formatDate, daysUntil, escapeHtml } from '../config.js';
import { showToast, performLogout } from '../auth.js';

const tbody = document.getElementById('vh-tbody');
if (tbody) initVehicleHealth();

let vehicles = [];
let currentOrg = null;
let searchTerm = '';

export async function initVehicleHealth() {
  const profile = await getUserProfile();
  if (!profile) return;
  const orgId = profile.organization_id;

  const fullName = profile.full_name || 'Maintenance Officer';
  const initials = fullName.split(/\s+/).map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'MO';
  
  const headerName = document.getElementById('header-user-name');
  const headerAvatar = document.getElementById('header-avatar');
  const sidebarName = document.getElementById('sidebar-name');
  const sidebarInitial = document.getElementById('sidebar-initial');

  if (headerName) headerName.textContent = fullName;
  if (headerAvatar) headerAvatar.textContent = initials;
  if (sidebarName) sidebarName.textContent = fullName;
  if (sidebarInitial) sidebarInitial.textContent = initials;

  if (orgId) {
    const { data: org } = await supabase.from('organizations').select('name, company_code').eq('id', orgId).maybeSingle();
    if (org) {
      currentOrg = org;
      document.querySelectorAll('#fc-org-name').forEach(el => el.textContent = org.name);
      const printOrg = document.getElementById('print-org-name');
      if (printOrg) printOrg.textContent = org.name;
    }
  }

  const printTime = document.getElementById('print-timestamp');
  if (printTime) printTime.textContent = new Date().toLocaleString('en-NG');

  const [vehiclesRes, ordersRes] = await Promise.all([
    supabase.from('vehicles').select('*').eq('organization_id', orgId).order('plate_number'),
    supabase.from('work_orders').select('vehicle_id, urgency').eq('organization_id', orgId).in('status', ['open', 'in_progress']),
  ]);

  if (vehiclesRes.error) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-rose-500 text-xs font-bold">Failed to load: ${escapeHtml(vehiclesRes.error.message)}</td></tr>`;
    return;
  }

  const openByVehicle = {};
  (ordersRes.data || []).forEach(o => {
    if (!openByVehicle[o.vehicle_id]) openByVehicle[o.vehicle_id] = [];
    openByVehicle[o.vehicle_id].push(o.urgency);
  });

  vehicles = (vehiclesRes.data || []).map(v => ({ ...v, openUrgencies: openByVehicle[v.id] || [] }));
  render();

  document.getElementById('vh-search')?.addEventListener('input', (e) => {
    searchTerm = e.target.value.trim().toLowerCase();
    render();
  });

  document.getElementById('btn-export-csv')?.addEventListener('click', exportVehicleHealthCSV);
  document.getElementById('btn-export-pdf')?.addEventListener('click', () => window.print());
  tbody.addEventListener('click', onTableClick);
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    if (confirm('Sign out from Maintenance Console?')) performLogout();
  });
}

function render() {
  let list = vehicles;
  if (searchTerm) {
    list = list.filter(v =>
      (v.plate_number || '').toLowerCase().includes(searchTerm) ||
      (v.make || '').toLowerCase().includes(searchTerm) ||
      (v.model || '').toLowerCase().includes(searchTerm)
    );
  }

  const countEl = document.getElementById('vh-count');
  if (countEl) countEl.textContent = `Showing ${list.length} of ${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'}`;

  if (vehicles.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-slate-400 text-xs">No vehicles registered yet.</td></tr>`;
    return;
  }
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-slate-400 text-xs">No matching vehicle records.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(rowHtml).join('');
}

function healthStatus(v) {
  if (v.openUrgencies.some(u => u === 'critical')) return { label: 'Critical Service', cls: 'bg-rose-50 text-rose-700 border-rose-200/60' };
  if (v.openUrgencies.length > 0) return { label: 'In Service', cls: 'bg-amber-50 text-amber-700 border-amber-200/60' };
  if (v.status === 'flagged') return { label: 'Flagged Issue', cls: 'bg-rose-50 text-rose-700 border-rose-200/60' };
  return { label: 'Operational', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200/60' };
}

function rowHtml(v) {
  const status = healthStatus(v);
  const d = daysUntil(v.roadworthiness_expiry);
  let rwCell = `<span class="text-slate-400 italic text-xs">Not recorded</span>`;
  
  if (v.roadworthiness_expiry) {
    const isExpired = d < 0;
    const isNear = d <= 30 && d >= 0;
    const cls = isExpired ? 'text-rose-600 font-bold' : isNear ? 'text-amber-600 font-bold' : 'text-slate-500';
    const icon = isExpired ? 'bi-exclamation-triangle-fill' : 'bi-calendar-check';
    rwCell = `<div class="flex items-center gap-1.5 ${cls}"><i class="bi ${icon}"></i> ${isExpired ? `Expired ${formatDate(v.roadworthiness_expiry)}` : formatDate(v.roadworthiness_expiry)}</div>`;
  }

  return `
    <tr class="hover:bg-slate-50/80 transition-colors" data-id="${v.id}">
      <td class="py-3 px-4">
        <div class="flex items-center gap-2">
          <span class="font-mono font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200">${escapeHtml(v.plate_number)}</span>
        </div>
      </td>
      <td class="py-3 px-4">
        <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${status.cls}">
          <span class="w-1.5 h-1.5 rounded-full bg-current"></span>
          ${status.label}
        </span>
      </td>
      <td class="py-3 px-4 text-slate-600">${escapeHtml([v.make, v.model, v.year].filter(Boolean).join(' ') || '—')}</td>
      <td class="py-3 px-4">${rwCell}</td>
      <td class="py-3 px-4 text-right no-print">
        <div class="flex items-center justify-end gap-1.5">
          <button class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition" data-action="flag" title="Flag for Maintenance">
            <i class="bi bi-flag-fill text-xs"></i>
          </button>
          <a class="p-1.5 text-slate-400 hover:text-brand-blue hover:bg-slate-100 rounded-lg transition" href="work-orders.html?vehicle=${v.id}" title="View Work Orders">
            <i class="bi bi-arrow-up-right text-xs"></i>
          </a>
        </div>
      </td>
    </tr>`;
}

async function onTableClick(e) {
  const btn = e.target.closest('[data-action="flag"]');
  if (!btn) return;
  const id = btn.closest('tr[data-id]')?.getAttribute('data-id');
  const vehicle = vehicles.find(v => v.id === id);
  if (!vehicle) return;
  if (!confirm(`Flag vehicle ${vehicle.plate_number} for urgent maintenance?`)) return;

  const { error } = await supabase.from('vehicles').update({ status: 'flagged' }).eq('id', id);
  if (error) { 
    showToast(error.message, 'error'); 
    return; 
  }
  vehicle.status = 'flagged';
  render();
  showToast(`${vehicle.plate_number} flagged for technical maintenance.`, 'success');
}

function exportVehicleHealthCSV() {
  if (vehicles.length === 0) {
    showToast('No vehicle records to export.', 'error');
    return;
  }

  const headers = ['Plate_Number', 'Make', 'Model', 'Year', 'Health_Condition', 'Roadworthiness_Expiry'];
  const rows = vehicles.map(v => [
    `"${v.plate_number || ''}"`,
    `"${v.make || ''}"`,
    `"${v.model || ''}"`,
    v.year || '',
    `"${healthStatus(v).label}"`,
    v.roadworthiness_expiry || ''
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const link = document.createElement('a');
  link.setAttribute('href', encodeURI(csvContent));
  link.setAttribute('download', `Vehicle_Health_${currentOrg?.company_code || 'FC'}_${new Date().toISOString().substring(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Vehicle health manifest exported as CSV.', 'success');
}