/**
 * ADMIN-FINANCE.JS — Fuel logs auditing, receipt previewing, and PDF/CSV export.
 */
import { supabase, getUserProfile, formatDate, formatNaira, escapeHtml } from '../config.js';
import { showToast, performLogout } from '../auth.js';

let orgId = null;
let currentOrg = null;
let fuelLogs = [];
let pendingReceiptFile = null;

const financeTbody = document.getElementById('finance-tbody');
const fuelTbody = document.getElementById('fuel-tbody');
if (financeTbody || fuelTbody) initFinance();

export async function initFinance() {
  const profile = await getUserProfile();
  if (!profile) return;
  orgId = profile.organization_id;

  const headerName = document.getElementById('header-user-name');
  if (headerName) headerName.textContent = profile.full_name || 'Admin';

  if (orgId) {
    const { data: org } = await supabase
      .from('organizations')
      .select('name, company_code')
      .eq('id', orgId)
      .maybeSingle();
    if (org) {
      currentOrg = org;
      document.querySelectorAll('#fc-org-name').forEach(el => el.textContent = org.name);
      const printOrg = document.getElementById('print-org-name');
      if (printOrg) printOrg.textContent = org.name;
    }
  }

  const printTime = document.getElementById('print-timestamp');
  if (printTime) printTime.textContent = new Date().toLocaleString('en-NG');

  await loadVehiclesDropdown();
  await loadFinancialLedger();
  await loadFuelLogs();

  document.getElementById('fuel-modal-close')?.addEventListener('click', closeFuelModal);
  document.getElementById('fuel-cancel-btn')?.addEventListener('click', closeFuelModal);
  document.getElementById('fuel-form')?.addEventListener('submit', handleCreateFuelLog);
  document.getElementById('fuel-receipt-input')?.addEventListener('change', (e) => {
    pendingReceiptFile = e.target.files[0] || null;
  });

  document.getElementById('btn-export-csv')?.addEventListener('click', exportFuelCSV);
  document.getElementById('btn-export-pdf')?.addEventListener('click', () => window.print());
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    if (confirm('Sign out from Admin Console?')) performLogout();
  });
}
window.initFinance = initFinance;

async function loadVehiclesDropdown() {
  const { data } = await supabase
    .from('vehicles')
    .select('id, plate_number, make, model')
    .eq('organization_id', orgId)
    .order('plate_number');

  const select = document.getElementById('fuel-vehicle');
  if (select) {
    select.innerHTML = (data || []).map(v => 
      `<option value="${v.id}">${escapeHtml(v.plate_number)} (${escapeHtml(v.make || '')})</option>`
    ).join('');
  }
}

async function loadFinancialLedger() {
  const now = new Date();
  const startThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const startLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const endLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();

  // Try querying with created_at as standard universal timestamp
  const [fuelThisRes, fuelLastRes, maintThisRes, maintLastRes] = await Promise.all([
    supabase.from('fuel_logs').select('amount_naira, created_at').eq('organization_id', orgId).gte('created_at', startThisMonth),
    supabase.from('fuel_logs').select('amount_naira, created_at').eq('organization_id', orgId).gte('created_at', startLastMonth).lte('created_at', endLastMonth),
    supabase.from('work_orders').select('cost_naira').eq('organization_id', orgId).gte('created_at', startThisMonth),
    supabase.from('work_orders').select('cost_naira').eq('organization_id', orgId).gte('created_at', startLastMonth).lte('created_at', endLastMonth)
  ]);

  const fuelThis = (fuelThisRes.data || []).reduce((acc, r) => acc + (Number(r.amount_naira) || 0), 0);
  const fuelLast = (fuelLastRes.data || []).reduce((acc, r) => acc + (Number(r.amount_naira) || 0), 0);
  const maintThis = (maintThisRes.data || []).reduce((acc, r) => acc + (Number(r.cost_naira) || 0), 0);
  const maintLast = (maintLastRes.data || []).reduce((acc, r) => acc + (Number(r.cost_naira) || 0), 0);
  const totalThis = fuelThis + maintThis;

  document.getElementById('kpi-total-this').textContent = formatNaira(totalThis);
  document.getElementById('kpi-fuel-this').textContent = formatNaira(fuelThis);
  document.getElementById('kpi-maint-this').textContent = formatNaira(maintThis);

  if (financeTbody) {
    financeTbody.innerHTML = `
      <tr class="hover:bg-slate-50 transition">
        <td class="py-3 px-4 font-bold text-slate-800 flex items-center gap-2">
          <i class="bi bi-fuel-pump text-amber-500"></i> Diesel & Fuel Logs
        </td>
        <td class="py-3 px-4 font-mono font-bold text-slate-900">${formatNaira(fuelThis)}</td>
        <td class="py-3 px-4 font-mono text-slate-500">${formatNaira(fuelLast)}</td>
        <td class="py-3 px-4 text-right font-bold ${fuelThis >= fuelLast ? 'text-rose-600' : 'text-emerald-600'}">
          ${calcVariance(fuelThis, fuelLast)}
        </td>
      </tr>
      <tr class="hover:bg-slate-50 transition">
        <td class="py-3 px-4 font-bold text-slate-800 flex items-center gap-2">
          <i class="bi bi-tools text-teal-600"></i> Maintenance & Repairs
        </td>
        <td class="py-3 px-4 font-mono font-bold text-slate-900">${formatNaira(maintThis)}</td>
        <td class="py-3 px-4 font-mono text-slate-500">${formatNaira(maintLast)}</td>
        <td class="py-3 px-4 text-right font-bold ${maintThis >= maintLast ? 'text-rose-600' : 'text-emerald-600'}">
          ${calcVariance(maintThis, maintLast)}
        </td>
      </tr>
    `;
  }
}

async function loadFuelLogs() {
  if (!fuelTbody) return;

  // Use explicit foreign key relationships and order by created_at
  const { data, error } = await supabase
    .from('fuel_logs')
    .select(`
      *,
      vehicle:vehicles!vehicle_id(plate_number),
      driver:profiles!driver_id(full_name)
    `)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false });

  if (error) {
    fuelTbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-rose-500 font-bold">Error loading fuel logs: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  fuelLogs = data || [];
  const countEl = document.getElementById('fuel-count');
  if (countEl) countEl.textContent = `${fuelLogs.length} recorded entries`;

  if (fuelLogs.length === 0) {
    fuelTbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-400">No fuel entries logged yet.</td></tr>`;
    return;
  }

  fuelTbody.innerHTML = fuelLogs.map(l => {
    let receiptButton = `<span class="text-slate-400 font-mono text-[11px]">—</span>`;
    if (l.receipt_url) {
      receiptButton = `
        <button onclick="previewReceipt('${l.receipt_url}')" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-700 font-bold transition">
          <i class="bi bi-image"></i>
          <span>Receipt</span>
        </button>`;
    }

    const logDate = l.purchased_at || l.created_at;

    return `
      <tr class="hover:bg-slate-50 transition">
        <td class="py-3 px-4 font-mono font-bold text-slate-900">${escapeHtml(l.vehicle?.plate_number || '—')}</td>
        <td class="py-3 px-4 font-medium text-slate-700">${escapeHtml(l.driver?.full_name || 'Admin / Office')}</td>
        <td class="py-3 px-4 font-mono">${l.liters ? Number(l.liters).toFixed(1) + ' L' : '—'}</td>
        <td class="py-3 px-4 font-mono text-slate-500">${l.odometer_km ? Number(l.odometer_km).toLocaleString('en-NG') + ' km' : '—'}</td>
        <td class="py-3 px-4">${receiptButton}</td>
        <td class="py-3 px-4 font-mono font-bold text-slate-900">${formatNaira(l.amount_naira || 0)}</td>
        <td class="py-3 px-4 text-right font-mono text-slate-400">${logDate ? formatDate(logDate) : '—'}</td>
      </tr>`;
  }).join('');
}

window.openFuelModal = function() {
  document.getElementById('fuel-modal')?.classList.remove('hidden');
};

window.closeFuelModal = function() {
  document.getElementById('fuel-modal')?.classList.add('hidden');
  document.getElementById('fuel-form')?.reset();
  pendingReceiptFile = null;
};

window.previewReceipt = function(url) {
  const modal = document.getElementById('receipt-modal');
  const img = document.getElementById('receipt-img-view');
  const link = document.getElementById('receipt-download-link');
  if (modal && img && link) {
    img.src = url;
    link.href = url;
    modal.classList.remove('hidden');
  }
};

window.closeReceiptModal = function() {
  document.getElementById('receipt-modal')?.classList.add('hidden');
};

async function handleCreateFuelLog(e) {
  e.preventDefault();
  const btn = document.getElementById('fuel-save-btn');
  btn.disabled = true;
  btn.textContent = 'Recording...';

  try {
    let receiptUrl = null;
    if (pendingReceiptFile) {
      const ext = pendingReceiptFile.name.split('.').pop();
      const path = `${orgId}/fuel_${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from('work-order-documents').upload(path, pendingReceiptFile);
      if (!uploadErr) {
        const { data: pubData } = supabase.storage.from('work-order-documents').getPublicUrl(path);
        receiptUrl = pubData.publicUrl;
      }
    }

    const payload = {
      organization_id: orgId,
      vehicle_id: document.getElementById('fuel-vehicle').value,
      amount_naira: Number(document.getElementById('fuel-amount').value),
      liters: Number(document.getElementById('fuel-liters').value) || null,
      odometer_km: Number(document.getElementById('fuel-odometer').value) || null,
      receipt_url: receiptUrl
    };

    const dateVal = document.getElementById('fuel-date').value;
    if (dateVal) {
      payload.purchased_at = new Date(dateVal).toISOString();
    }

    const { error } = await supabase.from('fuel_logs').insert(payload);
    if (error) throw error;

    showToast('Fuel expenditure logged.', 'success');
    closeFuelModal();
    await loadFinancialLedger();
    await loadFuelLogs();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Fuel Log';
  }
}

function calcVariance(cur, last) {
  if (!last || last === 0) return '+0%';
  const diff = ((cur - last) / last) * 100;
  return `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`;
}

function exportFuelCSV() {
  if (fuelLogs.length === 0) {
    showToast('No fuel logs to export.', 'error');
    return;
  }

  const headers = ['Vehicle_Plate', 'Driver_Submitter', 'Volume_Liters', 'Odometer_KM', 'Amount_NGN', 'Date', 'Receipt_URL'];
  const rows = fuelLogs.map(l => [
    `"${l.vehicle?.plate_number || ''}"`,
    `"${l.driver?.full_name || 'Admin / Office'}"`,
    l.liters || 0,
    l.odometer_km || 0,
    parseFloat(l.amount_naira || 0),
    l.purchased_at || l.created_at || '',
    `"${l.receipt_url || ''}"`
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const link = document.createElement('a');
  link.setAttribute('href', encodeURI(csvContent));
  link.setAttribute('download', `Fuel_Expenditures_${currentOrg?.company_code || 'FC'}_${new Date().toISOString().substring(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Fuel manifest exported as CSV.', 'success');
}