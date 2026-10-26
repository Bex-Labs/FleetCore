/**
 * ADMIN-TEAM.JS — Staff roster, multi-role invitations, user verification,
 * suspension, and account deletion for Company Admin.
 */

import { supabase, getUserProfile, formatDate, escapeHtml, avatarDataUri, statusBadge } from '../config.js';
import { showToast } from '../auth.js';

const ROLE_LABELS = {
  company_admin:       'Company Admin', 
  driver:              'Driver',
  maintenance_officer: 'Maintenance Officer', 
  account_manager:     'Account Manager',
};

const ROLE_BADGE_STYLES = {
  company_admin:       'bg-purple-50 text-purple-700 border border-purple-200/60 font-bold',
  driver:              'bg-blue-50 text-blue-700 border border-blue-200/60 font-semibold',
  maintenance_officer: 'bg-teal-50 text-teal-700 border border-teal-200/60 font-semibold',
  account_manager:     'bg-amber-50 text-amber-700 border border-amber-200/60 font-semibold',
};

const STATUS_MAP = {
  active:    { label: 'Active / Verified', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200/60' },
  inactive:  { label: 'Suspended',         cls: 'bg-rose-50 text-rose-700 border border-rose-200/60' },
  suspended: { label: 'Suspended',         cls: 'bg-rose-50 text-rose-700 border border-rose-200/60' },
  pending:   { label: 'Unverified',        cls: 'bg-amber-50 text-amber-700 border border-amber-200/60' },
};

let orgId = null;
let currentUserId = null;
let teamMembers = [];

const tbody = document.getElementById('team-tbody');
if (tbody) initTeam();

export async function initTeam() {
  const profile = await getUserProfile();
  if (!profile) return;
  
  orgId = profile.organization_id;
  currentUserId = profile.id;

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

  tbody.addEventListener('click', onTableActionClick);
  await loadTeam();
}
window.initTeam = initTeam;

window.loadTeam = async function() {
  if (!tbody || !orgId) return;

  tbody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-slate-400 font-medium">Fetching organization team roster...</td></tr>`;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false });

  const empty = document.getElementById('team-empty-state');
  const tableWrap = document.getElementById('team-table-container');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-rose-500 font-medium">Failed to load team: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  teamMembers = data || [];
  const teamCount = document.getElementById('team-count');
  if (teamCount) teamCount.textContent = `${teamMembers.length} Member${teamMembers.length === 1 ? '' : 's'}`;

  if (teamMembers.length === 0) {
    if (tableWrap) tableWrap.classList.add('hidden');
    if (empty) empty.classList.remove('hidden');
    return;
  }

  if (empty) empty.classList.add('hidden');
  if (tableWrap) tableWrap.classList.remove('hidden');

  tbody.innerHTML = teamMembers.map(p => {
    const isSelf = p.id === currentUserId;
    const isSuspended = p.status === 'inactive' || p.status === 'suspended';
    const isUnverified = p.status === 'pending';

    return `
      <tr class="hover:bg-slate-50/75 transition border-b border-slate-100 group" data-id="${p.id}">
        <td class="py-3.5 px-4">
          <div class="flex items-center gap-3">
            <img alt="Profile avatar" class="w-8 h-8 rounded-full object-cover border border-slate-200 shrink-0" src="${avatarDataUri(p.full_name)}"/>
            <div>
              <span class="text-xs font-bold text-slate-900 block">${escapeHtml(p.full_name || 'Unnamed')} ${isSelf ? '<span class="text-[10px] text-teal-600 font-semibold">(You)</span>' : ''}</span>
              <span class="text-[10px] text-slate-400">${escapeHtml(p.phone_number || '')}</span>
            </div>
          </div>
        </td>
        <td class="py-3.5 px-4 font-mono text-xs text-slate-700">${escapeHtml(p.email || '—')}</td>
        <td class="py-3.5 px-4">
          <span class="text-[11px] px-2.5 py-0.5 rounded-lg ${ROLE_BADGE_STYLES[p.role] || 'bg-slate-100 text-slate-700'}">
            ${escapeHtml(ROLE_LABELS[p.role] || p.role)}
          </span>
        </td>
        <td class="py-3.5 px-4">${statusBadge(p.status || 'active', STATUS_MAP)}</td>
        <td class="py-3.5 px-4 text-xs text-slate-500">${formatDate(p.created_at)}</td>
        <td class="py-3.5 px-4 text-right">
          ${!isSelf ? `
            <div class="inline-flex items-center gap-1">
              ${isUnverified ? `
                <button class="p-1.5 text-slate-400 hover:text-emerald-600 rounded-lg hover:bg-slate-100 transition" data-action="verify" title="Verify User Account">
                  <i class="bi bi-patch-check-fill text-sm"></i>
                </button>` : ''}
              
              <button class="p-1.5 text-slate-400 hover:${isSuspended ? 'text-emerald-600' : 'text-amber-600'} rounded-lg hover:bg-slate-100 transition" data-action="toggle-status" title="${isSuspended ? 'Reactivate Account' : 'Suspend Account'}">
                <i class="bi ${isSuspended ? 'bi-play-circle' : 'bi-pause-circle'} text-sm"></i>
              </button>

              <button class="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100 transition" data-action="delete" title="Delete User from Organization">
                <i class="bi bi-trash3 text-sm"></i>
              </button>
            </div>
          ` : `<span class="text-[11px] text-slate-400 italic">Protected</span>`}
        </td>
      </tr>`;
  }).join('');
};

function onTableActionClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const id = btn.closest('tr[data-id]')?.getAttribute('data-id');
  const member = teamMembers.find(m => m.id === id);
  if (!member) return;

  const action = btn.dataset.action;
  if (action === 'verify') verifyUser(member);
  if (action === 'toggle-status') toggleUserStatus(member);
  if (action === 'delete') deleteUser(member);
}

async function verifyUser(member) {
  if (!confirm(`Verify and activate ${member.full_name}'s account?`)) return;

  const { error } = await supabase
    .from('profiles')
    .update({ status: 'active' })
    .eq('id', member.id);

  if (error) {
    showToast(`Could not verify user: ${error.message}`, 'error');
    return;
  }

  showToast(`${member.full_name}'s account is verified and active.`, 'success');
  await window.loadTeam();
}

async function toggleUserStatus(member) {
  const isSuspended = member.status === 'inactive' || member.status === 'suspended';
  const nextStatus = isSuspended ? 'active' : 'suspended';

  if (!confirm(`${isSuspended ? 'Reactivate' : 'Suspend'} ${member.full_name}'s account?`)) return;

  const { error } = await supabase
    .from('profiles')
    .update({ status: nextStatus })
    .eq('id', member.id);

  if (error) {
    showToast(`Could not update account status: ${error.message}`, 'error');
    return;
  }

  showToast(`${member.full_name} has been ${nextStatus === 'active' ? 'reactivated' : 'suspended'}.`, 'success');
  await window.loadTeam();
}

async function deleteUser(member) {
  if (!confirm(`Permanently remove ${member.full_name} (${member.email}) from this organization? This action cannot be undone.`)) return;

  const { error } = await supabase
    .from('profiles')
    .delete()
    .eq('id', member.id);

  if (error) {
    showToast(`Could not delete user: ${error.message}`, 'error');
    return;
  }

  showToast(`${member.full_name} removed from organization roster.`, 'success');
  await window.loadTeam();
}

window.openInviteModal = function() {
  document.getElementById('invite-modal')?.classList.remove('hidden');
};

window.closeInviteModal = function() {
  document.getElementById('invite-modal')?.classList.add('hidden');
  document.getElementById('invite-form')?.reset();
};

window.handleStaffInvite = async function(e) {
  e.preventDefault();
  const btn = document.getElementById('invite-save-btn');
  const original = btn.innerHTML;

  btn.disabled = true;
  btn.innerHTML = `<i class="bi bi-arrow-repeat animate-spin"></i><span>Processing...</span>`;

  const mode = document.getElementById('invite-mode').value;
  const full_name = document.getElementById('invite-name').value.trim();
  const email = document.getElementById('invite-email').value.trim();
  const phone_number = document.getElementById('invite-phone').value.trim() || null;
  const role = document.getElementById('invite-role').value;

  if (!full_name || !email) {
    showToast('Name and email are required.', 'error');
    btn.disabled = false;
    btn.innerHTML = original;
    return;
  }

  try {
    const tempPassword = `FleetCore@${Math.floor(100000 + Math.random() * 900000)}`;

    const { data: edgeData, error: edgeError } = await supabase.functions.invoke('create-user', {
      body: { 
        email, 
        full_name, 
        role, 
        phone_number, 
        organization_id: orgId,
        password: tempPassword,
        send_email: true
      },
    });

    if (edgeError || edgeData?.error) {
      const { data: authData, error: authErr } = await supabase.auth.signUp({
        email,
        password: tempPassword,
        options: {
          data: {
            full_name,
            role,
            organization_id: orgId,
          }
        }
      });

      if (authErr) throw authErr;

      if (authData?.user) {
        await supabase.from('profiles').upsert({
          id: authData.user.id,
          organization_id: orgId,
          email,
          full_name,
          phone_number,
          role,
          status: 'active'
        });
      }
    }

    showToast(`Account created for ${full_name} (${ROLE_LABELS[role]}). Welcome details dispatched to ${email}.`, 'success');
    window.closeInviteModal();
    await window.loadTeam();
  } catch (err) {
    showToast(err.message || 'Could not complete staff account creation.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
};