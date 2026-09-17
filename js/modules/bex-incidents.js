/**
 * BEX-INCIDENTS.JS — Global cross-tenant incident and crisis management.
 */
import { supabase, getUserProfile, formatDate, escapeHtml, statusBadge } from '../config.js';
import { performLogout } from '../auth.js';

const tbody = document.getElementById('inc-tbody');
if (tbody) initBexIncidents();

let incidents = [];

const STATUS_MAP = {
  open: { label: 'Open Emergency', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  investigating: { label: 'Investigating', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  resolved: { label: 'Resolved', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
};

export async function initBexIncidents() {
  const profile = await getUserProfile();
  if (!profile) return;

  const fullName = profile.full_name || 'Bex Administrator';
  const initials = fullName.split(/\s+/).map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'BX';

  const headerName = document.getElementById('header-user-name');
  const headerAvatar = document.getElementById('header-avatar');
  if (headerName) headerName.textContent = fullName;
  if (headerAvatar) headerAvatar.textContent = initials;

  await loadIncidents();

  document.getElementById('inc-filter-status')?.addEventListener('change', () => renderTable());
}

async function loadIncidents() {
  try {
    // FIX: Provide explicit foreign key constraints (!organization_id, !vehicle_id, !driver_id)
    // to prevent PostgREST auto-aliasing duplicate paths as organizations_1
    const { data, error } = await supabase
      .from('incidents')
      .select(`
        *,
        organization:organizations!organization_id(name, company_code),
        vehicle:vehicles!vehicle_id(plate_number),
        driver:profiles!driver_id(full_name, phone_number)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;
    incidents = data || [];

    document.getElementById('inc-open-count').textContent = incidents.filter(i => i.status === 'open').length;
    document.getElementById('inc-investigating-count').textContent = incidents.filter(i => i.status === 'investigating').length;
    document.getElementById('inc-resolved-count').textContent = incidents.filter(i => i.status === 'resolved').length;

    renderTable();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-rose-500 font-bold">Failed to load platform incident stream: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderTable() {
  const filter = document.getElementById('inc-filter-status')?.value || 'all';
  let list = incidents;

  if (filter !== 'all') {
    list = list.filter(i => i.status === filter);
  }

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-400">All tenant fleets operating smoothly. No crisis alerts in selected range.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(i => `
    <tr class="hover:bg-slate-50 transition-colors">
      <td class="py-3 px-4">
        <span class="font-bold text-slate-900 block">${escapeHtml(i.organization?.name || 'Tenant')}</span>
        <span class="font-mono text-[10px] text-teal-700 font-bold block">${escapeHtml(i.organization?.company_code || '—')}</span>
      </td>
      <td class="py-3 px-4">
        <span class="font-bold text-rose-600 block text-xs capitalize">${escapeHtml((i.incident_type || 'Incident').replace('_', ' '))}</span>
        <span class="text-[11px] text-slate-500 block truncate max-w-xs">${escapeHtml(i.description || 'No descriptive payload')}</span>
      </td>
      <td class="py-3 px-4 font-mono font-bold text-slate-800">
        ${i.vehicle ? escapeHtml(i.vehicle.plate_number) : 'Unassigned'}
      </td>
      <td class="py-3 px-4">
        <span class="font-bold text-slate-800 block">${escapeHtml(i.driver?.full_name || 'Driver')}</span>
        <span class="font-mono text-[10px] text-slate-400 block">${escapeHtml(i.driver?.phone_number || '—')}</span>
      </td>
      <td class="py-3 px-4">
        ${statusBadge(i.status, STATUS_MAP)}
      </td>
      <td class="py-3 px-4 text-right font-mono text-slate-400 whitespace-nowrap">
        ${formatDate(i.created_at)}
      </td>
    </tr>`).join('');
}

document.getElementById('logout-btn')?.addEventListener('click', () => {
  if (confirm('Sign out from Bex Admin Console?')) performLogout();
});