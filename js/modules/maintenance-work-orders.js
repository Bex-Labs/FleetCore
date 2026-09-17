/**
 * MAINTENANCE-WORK-ORDERS.JS — Work order queue management, document uploads, and CSV/PDF export.
 */
import { supabase, getUserProfile, formatDate, formatNaira, escapeHtml, statusBadge } from '../config.js';
import { showToast, performLogout } from '../auth.js';

const STATUS_MAP = {
  open: { label: 'Open', cls: 'bg-amber-50 text-amber-700 border-amber-200/60' },
  in_progress: { label: 'In Progress', cls: 'bg-blue-50 text-brand-blue border-blue-200/60' },
  completed: { label: 'Completed', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200/60' },
  cancelled: { label: 'Cancelled', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
};

const URGENCY_CLS = {
  critical: 'text-rose-600 font-bold',
  high: 'text-amber-600 font-bold',
  normal: 'text-slate-800 font-semibold',
  low: 'text-slate-400 font-medium',
};

let orgId = null;
let currentOrg = null;
let orders = [];
let pendingReceiptFile = null;

const tbody = document.getElementById('wo-tbody');
if (tbody) initWorkOrders();

export async function initWorkOrders() {
  const profile = await getUserProfile();
  if (!profile) return;
  orgId = profile.organization_id;

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

  await loadVehiclesForModal();
  await loadOrders();

  document.getElementById('btn-new-wo')?.addEventListener('click', () => document.getElementById('wo-modal')?.classList.remove('hidden'));
  document.getElementById('wo-modal-close')?.addEventListener('click', closeModal);
  document.getElementById('wo-cancel-btn')?.addEventListener('click', closeModal);
  document.getElementById('wo-form')?.addEventListener('submit', onCreate);

  document.getElementById('wo-receipt-input')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      pendingReceiptFile = file;
      document.getElementById('wo-receipt-label').textContent = file.name;
    }
  });

  document.getElementById('btn-export-csv')?.addEventListener('click', exportWorkOrdersCSV);
  document.getElementById('btn-export-pdf')?.addEventListener('click', () => window.print());
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    if (confirm('Sign out from Maintenance Console?')) performLogout();
  });
}

function closeModal() {
  document.getElementById('wo-modal')?.classList.add('hidden');
  document.getElementById('wo-form')?.reset();
  pendingReceiptFile = null;
  const lbl = document.getElementById('wo-receipt-label');
  if (lbl) lbl.textContent = 'Attach Bill or Job Sheet';
}

async function loadVehiclesForModal() {
  const { data } = await supabase.from('vehicles').select('id, plate_number').eq('organization_id', orgId).order('plate_number');
  const select = document.getElementById('wo-vehicle');
  if (select) {
    select.innerHTML = (data || []).map(v => `<option value="${v.id}">${escapeHtml(v.plate_number)}</option>`).join('') || '<option value="">No vehicles registered</option>';
  }

  const params = new URLSearchParams(window.location.search);
  const preselect = params.get('vehicle');
  if (preselect && select) select.value = preselect;
}

async function loadOrders() {
  const { data, error } = await supabase
    .from('work_orders')
    .select('*, vehicle:vehicles(plate_number)')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false });

  const tableWrap = tbody.closest('.bg-white');
  const empty = document.getElementById('wo-empty');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-rose-500 text-xs font-bold">Failed to load: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  orders = data || [];
  if (orders.length === 0) {
    tableWrap.classList.add('hidden');
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');
  tableWrap.classList.remove('hidden');

  tbody.innerHTML = orders.map(o => {
    let receiptBtn = `<span class="text-slate-400 font-mono text-[11px]">—</span>`;
    if (o.receipt_url) {
      const isPdf = o.receipt_url.toLowerCase().endsWith('.pdf');
      const isDoc = o.receipt_url.toLowerCase().includes('.doc');
      const icon = isPdf ? 'bi-filetype-pdf text-rose-500' : isDoc ? 'bi-file-earmark-word text-blue-500' : 'bi-image text-teal-600';
      receiptBtn = `
        <a href="${o.receipt_url}" target="_blank" onclick="event.stopPropagation()" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold transition">
          <i class="bi ${icon}"></i>
          <span>Receipt</span>
        </a>`;
    }

    return `
      <tr class="hover:bg-slate-50 transition-colors cursor-pointer" onclick="window.location.href='work-order-detail.html?id=${o.id}'">
        <td class="py-3 px-4 font-mono font-bold text-slate-900">${o.vehicle ? escapeHtml(o.vehicle.plate_number) : '—'}</td>
        <td class="py-3 px-4 font-bold text-slate-800">${escapeHtml(o.service_type || '—')}</td>
        <td class="py-3 px-4 capitalize ${URGENCY_CLS[o.urgency] || ''}">${escapeHtml(o.urgency || 'normal')}</td>
        <td class="py-3 px-4">${statusBadge(o.status, STATUS_MAP)}</td>
        <td class="py-3 px-4">${receiptBtn}</td>
        <td class="py-3 px-4 font-mono font-bold text-slate-800">${formatNaira(o.cost_naira || 0)}</td>
        <td class="py-3 px-4 text-slate-500 text-right">${o.scheduled_date ? formatDate(o.scheduled_date) : '—'}</td>
      </tr>`;
  }).join('');
}

async function onCreate(e) {
  e.preventDefault();
  const btn = document.getElementById('wo-save-btn');
  const original = btn.textContent;
  btn.disabled = true; 
  btn.textContent = 'Creating...';

  const payload = {
    organization_id: orgId,
    vehicle_id: document.getElementById('wo-vehicle').value,
    service_type: document.getElementById('wo-service-type').value.trim(),
    description: document.getElementById('wo-description').value.trim() || null,
    urgency: document.getElementById('wo-urgency').value,
    cost_naira: Number(document.getElementById('wo-cost').value) || 0,
    scheduled_date: document.getElementById('wo-scheduled-date').value || null,
    status: 'open',
  };

  if (!payload.vehicle_id) {
    showToast('Select a target vehicle.', 'error');
    btn.disabled = false; 
    btn.textContent = original;
    return;
  }

  // Handle Receipt Upload if provided
  if (pendingReceiptFile) {
    try {
      const ext = pendingReceiptFile.name.split('.').pop();
      const path = `${orgId}/${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
      const { data: uploadRes, error: uploadErr } = await supabase.storage.from('work-order-documents').upload(path, pendingReceiptFile);
      if (uploadErr) throw uploadErr;

      const { data: publicUrlData } = supabase.storage.from('work-order-documents').getPublicUrl(path);
      payload.receipt_url = publicUrlData.publicUrl;
      payload.receipt_name = pendingReceiptFile.name;
    } catch (err) {
      showToast(`Attachment failed: ${err.message}`, 'error');
    }
  }

  const { error } = await supabase.from('work_orders').insert(payload);
  btn.disabled = false; 
  btn.textContent = original;

  if (error) { 
    showToast(error.message, 'error'); 
    return; 
  }

  showToast('Work order registered with document.', 'success');
  closeModal();
  await loadOrders();
}

function exportWorkOrdersCSV() {
  if (orders.length === 0) {
    showToast('No work orders to export.', 'error');
    return;
  }

  const headers = ['Plate_Number', 'Service_Type', 'Urgency', 'Status', 'Cost_NGN', 'Scheduled_Date', 'Receipt_Attachment_URL'];
  const rows = orders.map(o => [
    `"${o.vehicle?.plate_number || ''}"`,
    `"${o.service_type || ''}"`,
    o.urgency || 'normal',
    o.status || 'open',
    parseFloat(o.cost_naira || 0),
    o.scheduled_date || '',
    `"${o.receipt_url || ''}"`
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const link = document.createElement('a');
  link.setAttribute('href', encodeURI(csvContent));
  link.setAttribute('download', `Work_Orders_${currentOrg?.company_code || 'FC'}_${new Date().toISOString().substring(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Work order manifest exported as CSV.', 'success');
}