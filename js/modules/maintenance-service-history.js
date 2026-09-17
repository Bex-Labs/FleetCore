/**
 * MAINTENANCE-SERVICE-HISTORY.JS — Searchable completed maintenance history, receipt retrieval & CSV/PDF export.
 */
import { supabase, getUserProfile, formatDate, formatNaira, escapeHtml } from '../config.js';
import { showToast, performLogout } from '../auth.js';

const tbody = document.getElementById('sh-tbody');
if (tbody) initServiceHistory();

let records = [];
let currentOrg = null;
let searchTerm = '';

export async function initServiceHistory() {
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

  const { data, error } = await supabase
    .from('work_orders')
    .select('*, vehicle:vehicles(plate_number, make, model)')
    .eq('organization_id', orgId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false });

  const tableWrap = tbody.closest('.bg-white');
  const empty = document.getElementById('sh-empty');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-rose-500 text-xs font-bold">Failed to load: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  records = data || [];
  if (records.length === 0) {
    tableWrap.classList.add('hidden');
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');
  tableWrap.classList.remove('hidden');

  render();
  document.getElementById('sh-search')?.addEventListener('input', (e) => {
    searchTerm = e.target.value.trim().toLowerCase();
    render();
  });

  document.getElementById('btn-export-csv')?.addEventListener('click', exportServiceHistoryCSV);
  document.getElementById('btn-export-pdf')?.addEventListener('click', () => window.print());
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    if (confirm('Sign out from Maintenance Console?')) performLogout();
  });
}

function render() {
  let list = records;
  if (searchTerm) {
    list = list.filter(r =>
      (r.vehicle?.plate_number || '').toLowerCase().includes(searchTerm) ||
      (r.service_type || '').toLowerCase().includes(searchTerm) ||
      (r.parts_notes || '').toLowerCase().includes(searchTerm)
    );
  }

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-400 text-xs">No matching service records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(r => {
    let receiptDoc = `<span class="text-slate-400 font-mono text-[11px]">—</span>`;
    if (r.receipt_url) {
      const isPdf = r.receipt_url.toLowerCase().endsWith('.pdf');
      const isDoc = r.receipt_url.toLowerCase().includes('.doc');
      const icon = isPdf ? 'bi-filetype-pdf text-rose-500' : isDoc ? 'bi-file-earmark-word text-blue-500' : 'bi-image text-teal-600';
      receiptDoc = `
        <a href="${r.receipt_url}" target="_blank" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition">
          <i class="bi ${icon}"></i>
          <span>Receipt</span>
        </a>`;
    }

    return `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="py-3 px-4 font-mono font-bold text-slate-900">${r.vehicle ? escapeHtml(r.vehicle.plate_number) : '—'}</td>
        <td class="py-3 px-4 font-bold text-slate-800">${escapeHtml(r.service_type || '—')}</td>
        <td class="py-3 px-4 text-slate-500 font-mono">${r.completed_at ? formatDate(r.completed_at) : '—'}</td>
        <td class="py-3 px-4">${receiptDoc}</td>
        <td class="py-3 px-4 text-right font-mono font-bold text-slate-800">${formatNaira(r.cost_naira || 0)}</td>
        <td class="py-3 px-4 text-right text-slate-600 max-w-xs truncate">${escapeHtml(r.parts_notes || '—')}</td>
      </tr>`;
  }).join('');
}

function exportServiceHistoryCSV() {
  if (records.length === 0) {
    showToast('No service records to export.', 'error');
    return;
  }

  const headers = ['Vehicle_Plate', 'Service_Type', 'Date_Completed', 'Cost_NGN', 'Parts_Notes', 'Receipt_URL'];
  const rows = records.map(r => [
    `"${r.vehicle?.plate_number || ''}"`,
    `"${r.service_type || ''}"`,
    r.completed_at || '',
    parseFloat(r.cost_naira || 0),
    `"${r.parts_notes || ''}"`,
    `"${r.receipt_url || ''}"`
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const link = document.createElement('a');
  link.setAttribute('href', encodeURI(csvContent));
  link.setAttribute('download', `Service_History_${currentOrg?.company_code || 'FC'}_${new Date().toISOString().substring(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Service history exported as CSV.', 'success');
}