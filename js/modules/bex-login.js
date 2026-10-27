/**
 * BEX-LOGIN.JS — Super-Admin direct authentication & TOTP Challenge Resolution.
 */
import { supabase, getUserProfile } from '../config.js';

const form = document.getElementById('bex-login-form');
if (form) initBexLogin();

export function initBexLogin() {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('bex-btn');
    const alertBox = document.getElementById('bex-alert');
    const alertMsg = document.getElementById('bex-alert-msg');

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const totpCode = document.getElementById('totp') ? document.getElementById('totp').value.trim() : '';

    btn.disabled = true;
    btn.innerHTML = `<i class="bi bi-arrow-repeat animate-spin"></i> Authenticating...`;
    alertBox.classList.add('hidden');

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      // Verify Role Privilege FIRST
      const profile = await getUserProfile();
      if (!profile || (profile.role !== 'bex_admin' && profile.role !== 'super_admin')) {
        await supabase.auth.signOut();
        localStorage.clear();
        sessionStorage.clear();
        throw new Error('Access denied. This console is restricted to Bex Platform Administrators.');
      }

      // Check if user has TOTP enabled
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const verifiedTotp = (factors?.totp || []).find(f => f.status === 'verified');

      if (verifiedTotp) {
        if (!totpCode) {
          throw new Error('This root account requires a 6-digit TOTP code.');
        }

        const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({ factorId: verifiedTotp.id });
        if (chErr) throw chErr;

        const { error: vfErr } = await supabase.auth.mfa.verify({
          factorId: verifiedTotp.id,
          challengeId: challenge.id,
          code: totpCode
        });
        if (vfErr) throw new Error('Invalid TOTP token. Access denied.');
      }

      localStorage.setItem('fc_user_role', profile.role);
      window.location.href = 'dashboard.html';

    } catch (err) {
      alertMsg.textContent = err.message || 'Authentication failed.';
      alertBox.className = 'mb-3.5 p-3 rounded-xl border border-rose-500/30 bg-rose-500/20 text-xs flex items-center gap-2.5 transition';
      alertBox.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Authenticate Platform Root';
    }
  });
}