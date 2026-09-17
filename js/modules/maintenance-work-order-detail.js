/**
 * MAINTENANCE-WORK-ORDER-DETAIL.JS — Work order execution, photo uploads, and receipt attachments.
 */
import { supabase, getUserProfile, formatDate, formatNaira, escapeHtml, uploadFile } from '../config.js';
import { showToast, performLogout } from '../auth.js';

const content = document.getElementById('wod-content');
if (content) initWorkOrderDetail();

let workOrderId = null;
let workOrder = null;
let orgId = null;

export async function initWorkOrderDetail() {
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
    const { data: org } = await supabase.from('organizations').select('name').eq('id', orgId).maybeSingle();
    if (org?.name) {
      document.querySelectorAll('#fc-org-name').forEach(el => el.textContent = org.name);
    }
  }

  workOrderId = new URLSearchParams(window.location.search).get('id');
  if (!workOrderId) {
    content.innerHTML = `<div class="text-center py-12 text-slate-400 text-xs">No work order specified. <a class="text-teal-600 underline font-bold" href="work-orders.html">Back to Work Orders</a></div>`;
    return;
  }

  await loadWorkOrder();
}

async function loadWorkOrder() {
  const { data, error } = await supabase
    .from('work_orders')
    .select('*, vehicle:vehicles(plate_number, make, model, year, odometer_km)')
    .eq('id', workOrderId)
    .single();

  if (error || !data) {
    content.innerHTML = `<div class="text-center py-12 text-rose-500 text-xs font-bold">Work order not found.</div>`;
    return;
  }

  workOrder = data;
  document.getElementById('wod-title-id').textContent = `WO: ${workOrder.service_type || 'Service'}`;
  render();
}

const STATUS_CLS = {
  open: 'bg-amber-50 text-amber-700 border-amber-200/60',
  in_progress: 'bg-blue-50 text-brand-blue border-blue-200/60',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
};

const STATUS_LABEL = { open: 'Open', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled' };

function render() {
  const w = workOrder;
  const v = w.vehicle;

  content.innerHTML = `
    <!-- Top Summary Card -->
    <div class="bg-white border border-slate-200/80 p-5 rounded-2xl shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
      <div>
        <div class="flex items-center gap-2 mb-2">
          <span class="px-2.5 py-0.5 rounded-full ${STATUS_CLS[w.status]} text-[10px] font-bold border uppercase tracking-wider">${STATUS_LABEL[w.status]}</span>
          <span class="text-xs font-mono font-bold text-slate-400">Created: ${formatDate(w.created_at)}</span>
        </div>
        <h2 class="font-display text-xl sm:text-2xl font-black text-slate-900">${escapeHtml(w.service_type || 'Service Operation')}</h2>
        <p class="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
          <i class="bi bi-truck text-slate-400"></i>
          Vehicle: ${v ? `<span class="font-mono font-bold text-slate-800">${escapeHtml(v.plate_number)}</span> (${escapeHtml([v.make, v.model, v.year].filter(Boolean).join(' '))})` : 'Not linked'}
        </p>
      </div>
      <div class="flex gap-2 w-full md:w-auto" id="wod-actions"></div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
      <!-- Left 2 Cols: Details & Cost -->
      <div class="lg:col-span-2 space-y-5">
        <!-- Service Specs -->
        <section class="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-4">
          <h3 class="font-display text-sm font-bold text-slate-900 flex items-center gap-2">
            <i class="bi bi-card-text text-teal-600"></i> Service Specifications
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <span class="font-bold text-slate-400 uppercase tracking-wider block mb-1">Priority Urgency</span>
              <span class="font-bold text-slate-800 capitalize flex items-center gap-1.5">
                <i class="bi bi-exclamation-circle text-amber-500"></i> ${escapeHtml(w.urgency || 'normal')}
              </span>
            </div>
            <div>
              <span class="font-bold text-slate-400 uppercase tracking-wider block mb-1">Scheduled Date</span>
              <span class="font-bold text-slate-800">${w.scheduled_date ? formatDate(w.scheduled_date) : 'Not scheduled'}</span>
            </div>
            <div class="md:col-span-2">
              <span class="font-bold text-slate-400 uppercase tracking-wider block mb-1">Diagnostic Remarks</span>
              <div class="bg-slate-50 p-3 rounded-xl border border-slate-200 text-slate-700 leading-relaxed">${escapeHtml(w.description || 'No diagnostic remarks logged.')}</div>
            </div>
          </div>
        </section>

        <!-- Cost & Document Attachment Form -->
        <section class="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-4">
          <h3 class="font-display text-sm font-bold text-slate-900 flex items-center gap-2">
            <i class="bi bi-receipt text-teal-600"></i> Material Cost & Invoiced Receipts
          </h3>
          <form class="flex flex-col gap-3.5 text-xs" id="wod-cost-form">
            <div>
              <label class="block font-bold text-slate-700 uppercase tracking-wider mb-1">Total Maintenance Cost (₦)</label>
              <input class="w-full sm:w-64 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono font-bold text-slate-900 focus:border-teal-500 focus:outline-none" id="wod-cost" min="0" type="number" value="${w.cost_naira || 0}"/>
            </div>

            <div>
              <label class="block font-bold text-slate-700 uppercase tracking-wider mb-1">Parts Notes & Workshop Remarks</label>
              <textarea class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-teal-500 focus:outline-none" id="wod-parts-notes" rows="3">${escapeHtml(w.parts_notes || '')}</textarea>
            </div>

            <!-- Receipt Attachment Box -->
            <div>
              <label class="block font-bold text-slate-700 uppercase tracking-wider mb-1">Receipt / Invoice Document</label>
              ${w.receipt_url ? `
                <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                  <div class="flex items-center gap-2 truncate">
                    <i class="bi bi-file-earmark-check text-teal-600 text-base"></i>
                    <span class="font-semibold text-slate-800 truncate">${escapeHtml(w.receipt_name || 'Receipt Document')}</span>
                  </div>
                  <a href="${w.receipt_url}" target="_blank" class="px-3 py-1 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-xs font-bold text-slate-700 transition">
                    View
                  </a>
                </div>` : `
                <label class="block border-2 border-dashed border-slate-200 hover:border-teal-500 rounded-xl p-4 text-center cursor-pointer transition">
                  <i class="bi bi-paperclip text-lg text-teal-600 block mb-1"></i>
                  <span class="text-xs font-bold text-slate-700 block">Attach Job Sheet or Parts Bill</span>
                  <span class="text-[10px] text-slate-400 block mt-0.5">Image, PDF, or Word Document</span>
                  <input accept="image/*,.pdf,.doc,.docx" class="hidden" id="wod-receipt-input" type="file"/>
                </label>`}
            </div>

            <button class="self-start px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold transition shadow-sm" type="submit">
              Save Cost & Parts Records
            </button>
          </form>
        </section>
      </div>

      <!-- Right 1 Col: Vehicle Card & Workshop Photos -->
      <div class="space-y-5">
        <section class="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm space-y-3">
          <div class="flex items-center gap-2 border-b border-slate-100 pb-2.5">
            <i class="bi bi-truck text-slate-400"></i>
            <span class="text-xs font-bold text-slate-800 uppercase tracking-wider">Target Unit</span>
          </div>
          ${v ? `
            <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
              <span class="font-mono text-lg font-black text-slate-900 block">${escapeHtml(v.plate_number)}</span>
              <span class="text-[11px] text-slate-400">${escapeHtml([v.make, v.model].filter(Boolean).join(' ') || 'Standard Fleet Vehicle')}</span>
            </div>
            <div class="space-y-2 text-xs">
              <div class="flex justify-between border-b border-slate-100 pb-1.5"><span class="text-slate-400">Year</span><span class="font-bold">${v.year || '—'}</span></div>
              <div class="flex justify-between"><span class="text-slate-400">Odometer</span><span class="font-mono font-bold">${v.odometer_km ? Number(v.odometer_km).toLocaleString('en-NG') + ' km' : '—'}</span></div>
            </div>` : `<p class="text-xs text-slate-400 text-center py-4">No vehicle linked to order.</p>`}
        </section>

        <!-- Service Photos -->
        <section class="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm space-y-3">
          <h4 class="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <i class="bi bi-camera text-teal-600"></i> Workshop Photos
          </h4>
          <div class="space-y-3">
            <div>
              <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Before Repair</span>
              ${w.before_photo_url ? `<img class="w-full h-32 object-cover rounded-xl border border-slate-200" src="${w.before_photo_url}"/>` : `
                <label class="block border-2 border-dashed border-slate-200 hover:border-teal-500 rounded-xl p-4 text-center cursor-pointer transition">
                  <i class="bi bi-cloud-arrow-up text-xl text-teal-600 block mb-1"></i>
                  <span class="text-xs font-bold text-slate-700 block">Upload Before Photo</span>
                  <input accept="image/*" class="hidden" id="wod-before-input" type="file"/>
                </label>`}
            </div>
            <div>
              <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">After Repair</span>
              ${w.after_photo_url ? `<img class="w-full h-32 object-cover rounded-xl border border-slate-200" src="${w.after_photo_url}"/>` : `
                <label class="block border-2 border-dashed border-slate-200 hover:border-teal-500 rounded-xl p-4 text-center cursor-pointer transition">
                  <i class="bi bi-cloud-arrow-up text-xl text-teal-600 block mb-1"></i>
                  <span class="text-xs font-bold text-slate-700 block">Upload After Photo</span>
                  <input accept="image/*" class="hidden" id="wod-after-input" type="file"/>
                </label>`}
            </div>
          </div>
        </section>
      </div>
    </div>`;

  renderActions();
  document.getElementById('wod-cost-form')?.addEventListener('submit', onSaveCost);
  document.getElementById('wod-before-input')?.addEventListener('change', (e) => onPhotoUpload(e, 'before_photo_url'));
  document.getElementById('wod-after-input')?.addEventListener('change', (e) => onPhotoUpload(e, 'after_photo_url'));
  document.getElementById('wod-receipt-input')?.addEventListener('change', onReceiptUpload);
}

function renderActions() {
  const el = document.getElementById('wod-actions');
  const buttons = [];

  if (workOrder.status === 'open') {
    buttons.push({ label: 'Commence Repair', next: 'in_progress', icon: 'bi-play-circle', cls: 'bg-teal-600 hover:bg-teal-700 text-white' });
  }
  if (workOrder.status === 'open' || workOrder.status === 'in_progress') {
    buttons.push({ label: 'Finalize & Complete', next: 'completed', icon: 'bi-check-circle-fill', cls: 'bg-emerald-600 hover:bg-emerald-700 text-white' });
    buttons.push({ label: 'Halt / Cancel', next: 'cancelled', icon: 'bi-x-circle', cls: 'border border-slate-200 text-slate-600 hover:bg-slate-100 bg-white' });
  }

  el.innerHTML = buttons.map(b => `
    <button class="px-4 py-2 text-xs font-bold rounded-xl transition shadow-sm flex items-center justify-center gap-1.5 ${b.cls}" data-next="${b.next}">
      <i class="bi ${b.icon}"></i>
      <span>${b.label}</span>
    </button>`).join('');

  el.querySelectorAll('[data-next]').forEach(btn => 
    btn.addEventListener('click', () => updateStatus(btn.getAttribute('data-next')))
  );
}

async function updateStatus(next) {
  const payload = { status: next };
  if (next === 'completed') payload.completed_at = new Date().toISOString();
  
  const { error } = await supabase.from('work_orders').update(payload).eq('id', workOrderId);
  if (error) { 
    showToast(error.message, 'error'); 
    return; 
  }
  
  showToast(`Work order marked ${next.replace('_', ' ')}.`, 'success');
  await loadWorkOrder();
}

async function onSaveCost(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const original = btn.textContent;
  btn.disabled = true; 
  btn.textContent = 'Saving...';

  const payload = {
    cost_naira: Number(document.getElementById('wod-cost').value) || 0,
    parts_notes: document.getElementById('wod-parts-notes').value.trim() || null,
  };

  const { error } = await supabase.from('work_orders').update(payload).eq('id', workOrderId);
  btn.disabled = false; 
  btn.textContent = original;

  if (error) { 
    showToast(error.message, 'error'); 
    return; 
  }
  showToast('Costs and workshop notes saved.', 'success');
  await loadWorkOrder();
}

async function onReceiptUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  showToast('Uploading receipt document...', 'info');

  try {
    const ext = file.name.split('.').pop();
    const path = `${orgId}/${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
    const { error: uploadErr } = await supabase.storage.from('work-order-documents').upload(path, file);
    if (uploadErr) throw uploadErr;

    const { data: publicUrlData } = supabase.storage.from('work-order-documents').getPublicUrl(path);
    const { error } = await supabase.from('work_orders').update({
      receipt_url: publicUrlData.publicUrl,
      receipt_name: file.name
    }).eq('id', workOrderId);

    if (error) throw error;
    showToast('Receipt attached successfully.', 'success');
    await loadWorkOrder();
  } catch (err) {
    showToast(`Upload failed: ${err.message}`, 'error');
  }
}

async function onPhotoUpload(e, column) {
  const file = e.target.files[0];
  if (!file) return;
  showToast('Uploading repair photo...', 'info');

  try {
    const url = await uploadFile(file, 'work-orders');
    const { error } = await supabase.from('work_orders').update({ [column]: url }).eq('id', workOrderId);
    if (error) throw error;
    showToast('Photo uploaded.', 'success');
    await loadWorkOrder();
  } catch (err) {
    showToast(`Upload failed: ${err.message}`, 'error');
  }
}

document.getElementById('logout-btn')?.addEventListener('click', () => {
  if (confirm('Sign out from Maintenance Console?')) performLogout();
});