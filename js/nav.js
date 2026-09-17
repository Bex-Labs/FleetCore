/**
 * NAV.JS — Unified Navigation Controller & Role Guard
 * Handles active tab highlighting, mobile drawer toggles, and global user/org hydration.
 */
import { guardRole } from './auth.js';
import { supabase, getUserProfile, avatarDataUri } from './config.js';

async function bootstrapNavigation() {
  // 1. Role-Based Route Protection Guard
  const guard = document.body.getAttribute('data-fc-guard');
  if (guard) {
    await guardRole(guard);
  }

  // 2. Active Sidebar & Bottom Tab Bar Link Highlighting
  const currentPath = window.location.pathname.split('/').pop() || 'dashboard.html';
  
  document.querySelectorAll('nav a, aside a, [data-fc-nav]').forEach(link => {
    const href = (link.getAttribute('href') || '').split('/').pop();
    if (href === currentPath) {
      // Desktop Sidebar Active Style
      if (link.closest('aside') || link.closest('#sidebar')) {
        link.className = 'flex items-center gap-3 px-3.5 py-2.5 bg-blue-50 text-brand-blue font-bold text-xs rounded-xl transition border border-blue-100/60 shadow-sm';
        const icon = link.querySelector('i');
        if (icon) icon.className = icon.className.replace('text-slate-600', 'text-blue-600');
      }
      // Mobile Bottom Nav Active Style
      if (link.closest('nav.fixed')) {
        link.className = 'flex flex-col items-center justify-center text-teal-700 font-bold text-[10px] py-1 px-3 rounded-xl bg-teal-50 transition';
      }
    }
  });

  // 3. Mobile Hamburger & Drawer Toggle
  const toggleBtn = document.getElementById('fc-menu-toggle') || document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar') || document.querySelector('[data-fc-sidebar]');
  const overlay = document.getElementById('mobile-overlay');

  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => {
      const isClosed = sidebar.classList.contains('-translate-x-full');
      if (isClosed) {
        sidebar.classList.remove('-translate-x-full');
        if (overlay) overlay.classList.remove('hidden');
      } else {
        sidebar.classList.add('-translate-x-full');
        if (overlay) overlay.classList.add('hidden');
      }
    });
  }

  if (overlay && sidebar) {
    overlay.addEventListener('click', () => {
      sidebar.classList.add('-translate-x-full');
      overlay.classList.add('hidden');
    });
  }

  // 4. Global Organization & Profile Identity Hydration
  if (guard && supabase) {
    try {
      const profile = await getUserProfile();
      if (!profile) return;

      const displayName = profile.full_name || profile.email?.split('@')[0] || 'Fleet Member';
      const initials = displayName.trim().split(/\s+/).map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'FC';

      // Hydrate User Names
      document.querySelectorAll('#header-user-name, #header-driver-name, #sidebar-name, .fc-user-name').forEach(el => {
        el.textContent = displayName;
      });

      // Hydrate Text Initials
      document.querySelectorAll('#header-avatar, #sidebar-initial').forEach(el => {
        el.textContent = initials;
      });

      // Hydrate Image Avatars
      document.querySelectorAll('img[alt="User profile"], #driver-avatar-img').forEach(img => {
        if (profile.avatar_url) {
          img.src = profile.avatar_url;
        } else {
          img.src = avatarDataUri(displayName);
        }
        img.title = displayName;
      });

      // Resolve True Organization Name
      let orgName = 'TransCore Logistics';
      if (profile.organization_id) {
        const { data: org } = await supabase
          .from('organizations')
          .select('name')
          .eq('id', profile.organization_id)
          .maybeSingle();

        if (org?.name) orgName = org.name;
      } else {
        const { data: anyOrg } = await supabase.from('organizations').select('name').limit(1).maybeSingle();
        if (anyOrg?.name) orgName = anyOrg.name;
      }

      document.querySelectorAll('#fc-org-name').forEach(el => {
        el.textContent = orgName;
      });

      // Hydrate Vehicle / Unit Assignment if present
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('plate_number')
        .eq('assigned_driver_id', profile.id)
        .maybeSingle();

      const unitText = vehicle?.plate_number ? `BUS ${vehicle.plate_number}` : 'No unit assigned';
      document.querySelectorAll('#sidebar-bus, #header-vehicle-badge').forEach(el => {
        el.textContent = unitText;
      });

    } catch (err) {
      console.warn('Navigation identity hydration warning:', err);
    }
  }
}

// Auto-run safely across DOM loading states
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapNavigation);
} else {
  bootstrapNavigation();
}
