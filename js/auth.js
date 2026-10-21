/**
 * AUTH.JS — Authentication, Dynamic Role Routing & Multi-Tenant Session Management
 * Supported roles: super_admin | bex_admin | company_admin | admin | driver | maintenance_officer | account_manager
 */

import { supabase, getUserRole, getUserProfile } from './config.js';

export const ROLE_REDIRECTS = {
  super_admin:         '/bex-admin/dashboard.html',
  bex_admin:           '/bex-admin/dashboard.html',
  company_admin:       '/admin/dashboard.html',
  admin:               '/admin/dashboard.html',
  driver:              '/driver/dashboard.html',
  maintenance_officer: '/maintenance/dashboard.html',
  account_manager:     '/finance/dashboard.html',
};

export const ROLE_NAMES = {
  super_admin:         'Super Admin (Bex)',
  bex_admin:           'Bex Admin',
  company_admin:       'Company Admin',
  admin:               'Company Admin',
  driver:              'Driver',
  maintenance_officer: 'Maintenance Officer',
  account_manager:     'Account Manager',
};

function rootPath(path) {
  const depth = window.location.pathname.split('/').filter(Boolean).length - 1;
  const prefix = depth > 0 ? '../'.repeat(depth) : './';
  return prefix + path.replace(/^\//, '');
}

export function slugify(name) {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function showToast(message, type = 'info', duration = 4000) {
  let host = document.getElementById('fc-toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'fc-toast-host';
    host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
    document.body.appendChild(host);
  }
  
  const colors = {
    success: '#059669', 
    error: '#DC2626', 
    info: '#2563EB', 
    warning: '#D97706',
  };

  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `background:${colors[type] || colors.info};color:#fff;padding:12px 16px;border-radius:12px;font-family:Inter,sans-serif;font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.15);max-width:360px;opacity:0;transform:translateX(8px);transition:all .25s ease;pointer-events:auto;`;
  
  host.appendChild(toast);
  requestAnimationFrame(() => { 
    toast.style.opacity = '1'; 
    toast.style.transform = 'translateX(0)'; 
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(8px)';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}
window.showToast = window.showToast || showToast;

/**
 * Primary Unified Login & Auto-Routing Handler
 * Validates tenant code, checks profile credentials, and redirects by role.
 */
export async function authenticateTenantUser(orgCode, email, password) {
  const cleanCode = (orgCode || '').trim().toUpperCase();
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanPassword = (password || '').trim();

  if (!cleanEmail || !cleanPassword) {
    throw new Error('Please enter both your email address and password.');
  }

  // 1. Authenticate with Supabase
  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
    email: cleanEmail,
    password: cleanPassword
  });

  if (authErr) throw authErr;

  const userId = authData.user.id;

  // 2. Fetch User Profile
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('id, full_name, role, organization_id, status')
    .eq('id', userId)
    .single();

  if (profileErr || !profile) {
    await supabase.auth.signOut();
    throw new Error('User profile record not found. Please contact support.');
  }

  if (profile.status === 'inactive' || profile.status === 'suspended') {
    await supabase.auth.signOut();
    throw new Error('Your account is currently inactive. Contact your administrator.');
  }

  // 3. Platform Super Admin Bypass (No code required, or code "BEX")
  const isSuperAdmin = profile.role === 'super_admin' || profile.role === 'bex_admin';
  if (isSuperAdmin) {
    localStorage.setItem('fc_user_role', 'super_admin');
    localStorage.removeItem('fc_org_code');
    window.location.href = rootPath(ROLE_REDIRECTS[profile.role] || '/bex-admin/dashboard.html');
    return;
  }

  // 4. Validate Tenant Organization Code for regular organization accounts
  if (!cleanCode) {
    await supabase.auth.signOut();
    throw new Error('Please enter your 3-letter Organization Code (e.g. TCL).');
  }

  if (!profile.organization_id) {
    await supabase.auth.signOut();
    throw new Error('Your account is not assigned to any organization.');
  }

  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('id, name, code')
    .eq('id', profile.organization_id)
    .single();

  if (orgErr || !org) {
    await supabase.auth.signOut();
    throw new Error('Assigned organization could not be found.');
  }

  if ((org.code || '').toUpperCase() !== cleanCode) {
    await supabase.auth.signOut();
    throw new Error(`Invalid credentials for organization code "${cleanCode}".`);
  }

  // 5. Cache tenant details in local storage
  localStorage.setItem('fc_org_code', org.code);
  localStorage.setItem('fc_org_name', org.name);
  localStorage.setItem('fc_user_role', profile.role);

  // 6. Auto-route by detected role
  redirectByRole(profile.role);
}
window.authenticateTenantUser = authenticateTenantUser;

// Initialize Auth State Watcher
if (supabase) {
  supabase.auth.onAuthStateChange((event, session) => {
    const authPages = ['index.html', 'forgot-password.html', 'reset-password.html', ''];
    const currentPage = window.location.pathname.split('/').pop();
    const isAuthPage = authPages.includes(currentPage) || currentPage === 'login.html';

    if (
      window.location.hash.includes('access_token=') ||
      window.location.pathname.includes('confirm.html')
    ) return;

    // Suppress automatic listener redirection if an explicit login attempt is running
    if (event === 'SIGNED_IN' && session && isAuthPage) {
      if (window.fcIsExplicitLogin) return;
      redirectByRole();
    }
    
    if (event === 'SIGNED_OUT') {
      const onProtectedPage = !['index.html', 'forgot-password.html', 'reset-password.html', 'confirm.html', 'login.html']
        .some(p => window.location.pathname.includes(p));
      if (onProtectedPage) {
        window.location.replace(rootPath('index.html'));
      }
    }
    
    if (event === 'PASSWORD_RECOVERY') {
      window.location.href = rootPath('reset-password.html');
    }
  });
}

export async function redirectByRole(passedRole) {
  const role = passedRole || await getUserRole();
  if (!role) { 
    showToast('Could not determine account role. Please contact support.', 'error'); 
    return; 
  }
  
  const path = ROLE_REDIRECTS[role] || '/admin/dashboard.html';
  const targetFolder = path.split('/')[1];
  if (window.location.pathname.includes(`/${targetFolder}/`)) return;
  window.location.href = rootPath(path);
}

// ─── Route Guard ─────────────────────────────────────────────────────────
export async function guardRole(expectedFolder) {
  if (!supabase) return;
  const role = await getUserRole();
  if (!role) { 
    window.location.replace(rootPath('index.html')); 
    return; 
  }

  // Super admins are permitted across all folders
  if (role === 'super_admin' || role === 'bex_admin') return;
  
  const path = ROLE_REDIRECTS[role];
  const folder = path ? path.split('/')[1] : null;
  if (folder !== expectedFolder) {
    showToast('This page is only available to authorized users.', 'error');
    window.location.replace(rootPath(path || 'index.html'));
  }
}

// ─── Forgot Password Form Listener ─────────────────────────────────────────
const forgotForm = document.getElementById('forgot-form');
if (forgotForm && supabase) {
  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const btn = document.getElementById('send-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = 'Sending…'; }
    
    const BASE_URL = window.location.origin;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { 
      redirectTo: `${BASE_URL}/reset-password.html` 
    });
    
    if (error) {
      showToast(error.message, 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = 'Send Recovery Link'; }
      return;
    }
    
    showToast(`Recovery link sent to ${email}`, 'success');
    const stepRequest = document.getElementById('step-request');
    const stepSent = document.getElementById('step-sent');
    if (stepRequest) stepRequest.style.display = 'none';
    if (stepSent) stepSent.style.display = 'block';
    const sentTo = document.getElementById('sent-to');
    if (sentTo) sentTo.textContent = email;
  });
}

// ─── Reset Password Form Listener ──────────────────────────────────────────
const resetForm = document.getElementById('reset-form');
if (resetForm && supabase) {
  resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('new-password').value;
    const confirm = document.getElementById('confirm-password').value;
    
    if (password !== confirm) { 
      showToast('Passwords do not match.', 'error'); 
      return; 
    }
    if (password.length < 6) {
      showToast('Password must be at least 6 characters long.', 'error');
      return;
    }
    
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { 
      showToast(error.message, 'error'); 
      return; 
    }
    
    showToast('Password updated. Redirecting to login…', 'success');
    setTimeout(() => window.location.replace(rootPath('index.html')), 1500);
  });
}

// ─── Universal Robust Logout Handler ──────────────────────────────────────
export async function performLogout() {
  try {
    if (supabase) {
      await supabase.auth.signOut();
    }
  } catch (err) {
    console.warn('Signout note:', err);
  } finally {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.includes('sb-') || key.includes('auth-token') || key.includes('supabase') || key.includes('fc_') || key.includes('fleetcore'))) {
        localStorage.removeItem(key);
      }
    }
    sessionStorage.clear();
    window.location.replace(rootPath('index.html'));
  }
}
window.performLogout = performLogout;

// Global Delegated Click Listener for All Sidebar and Header Logout Elements
document.addEventListener('click', (e) => {
  const logoutTrigger = e.target.closest('#logout-btn, #logout-link, [data-fc-logout], a[href*="logout"]');
  if (logoutTrigger) {
    e.preventDefault();
    performLogout();
  }
});