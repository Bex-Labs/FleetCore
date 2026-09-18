/**
 * CONFIG.JS — Supabase Client Initialization
 * FleetCore — standardized on: organizations table, organization_id on profiles
 */

const SUPABASE_URL = 'https://toftrzitubdzhrdtkyyu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvZnRyeml0dWJkemhyZHRreXl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5MDY0MTMsImV4cCI6MjEwMzQ4MjQxM30.X45H1mHqQms9SBhYB63BDjsnkc_da6Bl8RwL0S4G80I';

if (!window.supabase) {
  console.error('Supabase CDN failed to load. Check your internet connection.');
}

export const supabase = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    })
  : null;

// Expose globally for inline scripts and auth hooks
window.supabaseClient = supabase;

// ─── Get current authenticated user ───────────────────────────────────────
export async function getCurrentUser() {
  if (!supabase) return null;
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) return null;
    return user;
  } catch {
    return null;
  }
}

// ─── Get role from profiles table, fall back to user_metadata ─────────────
export async function getUserRole() {
  const user = await getCurrentUser();
  if (!user || !supabase) return null;

  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (error || !profile) {
      return user.user_metadata?.role || null;
    }
    return profile.role;
  } catch {
    return user.user_metadata?.role || null;
  }
}

// ─── Get full profile including organization_id ────────────────────────────
export async function getUserProfile() {
  const user = await getCurrentUser();
  if (!user || !supabase) return null;

  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, full_name, role, organization_id, email, avatar_url, phone_number')
      .eq('id', user.id)
      .single();

    if (error) return null;
    return profile;
  } catch {
    return null;
  }
}

// ─── Formatting helpers ──────────────────────────────────────────────────
export function formatNaira(amount) {
  const n = Number(amount || 0);
  return '₦' + n.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(dateStr);
}

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || name[0].toUpperCase();
}

export function avatarDataUri(name) {
  const txt = escapeHtml(initials(name));
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><rect width='40' height='40' rx='20' fill='%23004AC6'/><text x='20' y='26' font-family='Inter,Arial,sans-serif' font-size='15' font-weight='600' fill='white' text-anchor='middle'>${txt}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg).replace(/'/g, '%27');
}

export function statusBadge(status, map) {
  const s = map[status] || { label: status || 'Unknown', cls: 'bg-surface-container-high text-on-surface-variant' };
  return `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${s.cls}">${s.label}</span>`;
}

export async function uploadFile(file, folder) {
  if (!file) return null;
  const ext = file.name.split('.').pop();
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('fleet-uploads').upload(path, file, { upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from('fleet-uploads').getPublicUrl(path);
  return data.publicUrl;
}