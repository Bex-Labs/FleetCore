/**
 * AUTH.JS — Authentication, Role-Based Routing & Global Session Management
 * FleetCore roles: company_admin | driver | maintenance_officer | account_manager | bex_admin
 */

import { supabase, getUserRole } from './config.js';

const ROLE_REDIRECTS = {
  bex_admin:           '/bex-admin/dashboard.html',
  company_admin:       '/admin/dashboard.html',
  driver:              '/driver/dashboard.html',
  maintenance_officer: '/maintenance/dashboard.html',
  account_manager:     '/finance/dashboard.html',
};

const ROLE_NAMES = {
  bex_admin:           'Bex Admin',
  company_admin:       'Company Admin',
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

async function resolveActiveTenant() {
  window.activeTenantId = null;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return;
  
  const isHostingPlatform = (
    host.endsWith('.vercel.app') || host.endsWith('.netlify.app') ||
    host.endsWith('.pages.dev')  || host.endsWith('.github.io') ||
    host.endsWith('.onrender.com') || host.endsWith('.railway.app') || host.endsWith('.fly.dev')
  );
  if (isHostingPlatform) return;

  const parts = host.split('.');
  if (parts.length <= 2 || ['www', 'admin', 'app'].includes(parts[0])) return;
  const subToken = parts[0].toLowerCase().trim();
  
  if (!supabase) return;
  try {
    const { data: org, error } = await supabase.from('organizations').select('id, name').eq('subdomain', subToken).single();
    if (!error && org) {
      window.activeTenantId = org.id;
      const brandHeader = document.getElementById('login-org-title');
      if (brandHeader) brandHeader.textContent = org.name;
    } else if (subToken) {
      showToast('Unrecognised company domain.', 'error');
    }
  } catch (err) {
    console.warn('Tenant domain resolution error:', err);
  }
}

// Initialize Auth Watcher
if (supabase) {
  resolveActiveTenant();

  supabase.auth.onAuthStateChange((event, session) => {
    const authPages = ['index.html', 'forgot-password.html', 'reset-password.html', ''];
    const currentPage = window.location.pathname.split('/').pop();
    const isAuthPage = authPages.includes(currentPage) || currentPage === 'login.html';

    if (
      window.location.hash.includes('access_token=') ||
      window.location.pathname.includes('confirm.html')
    ) return;

    // Do NOT auto-redirect if an explicit login attempt is running strict role validation
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

export async function redirectByRole() {
  const role = await getUserRole();
  if (!role) { 
    showToast('Could not determine account role. Please contact support.', 'error'); 
    return; 
  }
  
  const path = ROLE_REDIRECTS[role];
  if (!path) { 
    showToast('Unrecognised role on this account.', 'error'); 
    return; 
  }
  
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
  
  const path = ROLE_REDIRECTS[role];
  const folder = path ? path.split('/')[1] : null;
  if (folder !== expectedFolder) {
    showToast(`This page is only available to authorized users.`, 'error');
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
    // Clear all Supabase auth storage tokens
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.includes('sb-') || key.includes('auth-token') || key.includes('supabase') || key.includes('fleetcore'))) {
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