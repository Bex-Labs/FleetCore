/**
 * ADMIN-ANALYTICS.JS — Fleet performance intelligence and driver audit drawer.
 */
import { supabase, getUserProfile, formatDate, formatNaira, escapeHtml } from '../config.js';
import { performLogout } from '../auth.js';

let orgId = null;
let driversList = [];

const leaderboardTbody = document.getElementById('leaderboard-tbody');
if (leaderboardTbody) initAnalytics();

export async function initAnalytics() {
  const profile = await getUserProfile();
  if (!profile) return;
  orgId = profile.organization_id;

  const headerName = document.getElementById('header-user-name');
  if (headerName) headerName.textContent = profile.full_name || 'Admin';

  if (orgId) {
    const { data: org } = await supabase.from('organizations').select('name').eq('id', orgId).maybeSingle();
    if (org) {
      document.querySelectorAll('#fc-org-name').forEach(el => el.textContent = org.name);
    }
  }

  await loadTopMetrics();
  await loadDriverLeaderboard();
  await loadWeeklyTripsChart();

  document.getElementById('logout-btn')?.addEventListener('click', () => {
    if (confirm('Sign out from Admin Console?')) performLogout();
  });
}
window.initAnalytics = initAnalytics;

async function loadTopMetrics() {
  const [tripsRes, vehiclesRes, fuelRes] = await Promise.all([
    supabase.from('trips').select('status').eq('organization_id', orgId),
    supabase.from('vehicles').select('odometer_km, status').eq('organization_id', orgId),
    supabase.from('fuel_logs').select('amount_naira').eq('organization_id', orgId)
  ]);

  const trips = tripsRes.data || [];
  const completedTrips = trips.filter(t => t.status === 'completed').length;
  const totalTrips = trips.length;
  const ontimePct = totalTrips > 0 ? Math.round((completedTrips / totalTrips) * 100) : 100;
  
  document.getElementById('kpi-ontime-pct').textContent = `${ontimePct}%`;
  document.getElementById('kpi-ontime-sub').textContent = `${completedTrips} of ${totalTrips} completed trips`;

  const vehicles = vehiclesRes.data || [];
  const totalKm = vehicles.reduce((acc, v) => acc + (Number(v.odometer_km) || 0), 0);
  document.getElementById('kpi-total-distance').textContent = `${totalKm.toLocaleString('en-NG')} km`;
  document.getElementById('kpi-vehicle-count').textContent = `Across ${vehicles.length} vehicle units`;

  const fuelLogs = fuelRes.data || [];
  const totalFuel = fuelLogs.reduce((acc, f) => acc + (Number(f.amount_naira) || 0), 0);
  document.getElementById('kpi-fuel-total').textContent = formatNaira(totalFuel);

  renderFleetComposition(vehicles);
}

function renderFleetComposition(vehicles) {
  const container = document.getElementById('fleet-composition-chart');
  if (!container) return;

  const total = vehicles.length;
  if (total === 0) {
    container.innerHTML = `<div class="text-center text-slate-400 text-xs">No vehicles registered.</div>`;
    return;
  }

  const operational = vehicles.filter(v => v.status === 'operational' || v.status === 'active' || !v.status).length;
  const inService = vehicles.filter(v => v.status === 'maintenance' || v.status === 'in_service').length;
  const flagged = vehicles.filter(v => v.status === 'flagged' || v.status === 'repair').length;

  container.innerHTML = `
    <div class="space-y-2">
      <div class="flex justify-between text-xs">
        <span class="font-semibold text-slate-600 flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Operational</span>
        <span class="font-bold text-slate-800">${operational} (${Math.round((operational/total)*100)}%)</span>
      </div>
      <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
        <div class="bg-emerald-500 h-full" style="width: ${(operational/total)*100}%"></div>
      </div>
    </div>

    <div class="space-y-2">
      <div class="flex justify-between text-xs">
        <span class="font-semibold text-slate-600 flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span> Maintenance</span>
        <span class="font-bold text-slate-800">${inService} (${Math.round((inService/total)*100)}%)</span>
      </div>
      <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
        <div class="bg-amber-500 h-full" style="width: ${(inService/total)*100}%"></div>
      </div>
    </div>

    <div class="space-y-2">
      <div class="flex justify-between text-xs">
        <span class="font-semibold text-slate-600 flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-rose-500"></span> Flagged / Issue</span>
        <span class="font-bold text-slate-800">${flagged} (${Math.round((flagged/total)*100)}%)</span>
      </div>
      <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
        <div class="bg-rose-500 h-full" style="width: ${(flagged/total)*100}%"></div>
      </div>
    </div>
  `;
}

async function loadDriverLeaderboard() {
  const [driversRes, tripsRes, incidentsRes] = await Promise.all([
    supabase.from('profiles').select('id, full_name, phone_number, license_expiry').eq('organization_id', orgId).eq('role', 'driver'),
    supabase.from('trips').select('driver_id, status').eq('organization_id', orgId),
    supabase.from('incidents').select('driver_id').eq('organization_id', orgId)
  ]);

  const rawDrivers = driversRes.data || [];
  const trips = tripsRes.data || [];
  const incidents = incidentsRes.data || [];

  driversList = rawDrivers.map(d => {
    const driverTrips = trips.filter(t => t.driver_id === d.id);
    const completed = driverTrips.filter(t => t.status === 'completed').length;
    const incCount = incidents.filter(i => i.driver_id === d.id).length;
    const score = Math.max(100 - (incCount * 15), 50);

    return {
      ...d,
      completedTrips: completed,
      incidentCount: incCount,
      score
    };
  });

  driversList.sort((a, b) => b.score - a.score || b.completedTrips - a.completedTrips);

  if (driversList.length === 0) {
    leaderboardTbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-slate-400">No driver accounts registered.</td></tr>`;
    return;
  }

  leaderboardTbody.innerHTML = driversList.map((d, index) => {
    let rankBadge = `<span class="font-bold text-slate-500">${index + 1}</span>`;
    if (index === 0) rankBadge = `<span class="w-6 h-6 rounded-full bg-amber-100 text-amber-700 font-black inline-flex items-center justify-center">1</span>`;
    if (index === 1) rankBadge = `<span class="w-6 h-6 rounded-full bg-slate-200 text-slate-700 font-black inline-flex items-center justify-center">2</span>`;
    if (index === 2) rankBadge = `<span class="w-6 h-6 rounded-full bg-amber-700/20 text-amber-900 font-black inline-flex items-center justify-center">3</span>`;

    return `
      <tr class="hover:bg-slate-50 transition cursor-pointer" onclick="openDriverModal('${d.id}')">
        <td class="py-3 px-4 text-center">${rankBadge}</td>
        <td class="py-3 px-4 font-bold text-slate-900">
          ${escapeHtml(d.full_name || 'Driver')}
          <span class="text-[10px] text-slate-400 font-mono block">${escapeHtml(d.phone_number || 'No phone logged')}</span>
        </td>
        <td class="py-3 px-4 font-mono font-semibold text-slate-800">${d.completedTrips} trips</td>
        <td class="py-3 px-4">
          <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${d.score >= 90 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}">
            ${d.score}%
          </span>
        </td>
        <td class="py-3 px-4 text-right font-mono font-bold ${d.incidentCount > 0 ? 'text-rose-600' : 'text-slate-400'}">${d.incidentCount}</td>
      </tr>`;
  }).join('');
}

window.openDriverModal = function(driverId) {
  const driver = driversList.find(d => d.id === driverId);
  if (!driver) return;

  const modal = document.getElementById('driver-detail-modal');
  const nameEl = document.getElementById('modal-driver-name');
  const phoneEl = document.getElementById('modal-driver-phone');
  const initialEl = document.getElementById('modal-driver-initial');
  const tripsEl = document.getElementById('modal-trips-count');
  const safetyEl = document.getElementById('modal-safety-rating');
  const licenseEl = document.getElementById('modal-license-expiry');
  const incEl = document.getElementById('modal-incidents-count');

  if (nameEl) nameEl.textContent = driver.full_name || 'Driver';
  if (phoneEl) phoneEl.textContent = driver.phone_number || 'No contact phone';
  if (initialEl) initialEl.textContent = (driver.full_name || 'DR').substring(0, 2).toUpperCase();
  if (tripsEl) tripsEl.textContent = driver.completedTrips;
  if (safetyEl) safetyEl.textContent = `${driver.score}%`;
  if (licenseEl) licenseEl.textContent = driver.license_expiry ? formatDate(driver.license_expiry) : 'Not recorded';
  if (incEl) incEl.textContent = driver.incidentCount;

  modal?.classList.remove('hidden');
};

window.closeDriverModal = function() {
  document.getElementById('driver-detail-modal')?.classList.add('hidden');
};

async function loadWeeklyTripsChart() {
  const chartEl = document.getElementById('weekly-trip-chart');
  if (!chartEl) return;

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const { data: trips } = await supabase
    .from('trips')
    .select('created_at')
    .eq('organization_id', orgId)
    .gte('created_at', sevenDaysAgo.toISOString());

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dailyCounts = [0, 0, 0, 0, 0, 0, 0];
  const dayLabels = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    dayLabels.push(days[d.getDay()]);
  }

  (trips || []).forEach(t => {
    const tripDate = new Date(t.created_at);
    const dayDiff = Math.floor((tripDate - sevenDaysAgo) / (1000 * 60 * 60 * 24));
    if (dayDiff >= 0 && dayDiff < 7) {
      dailyCounts[dayDiff]++;
    }
  });

  const maxVal = Math.max(...dailyCounts, 1);

  chartEl.innerHTML = dailyCounts.map((count, idx) => {
    const heightPct = Math.max((count / maxVal) * 100, 10);
    return `
      <div class="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
        <span class="text-[10px] font-mono font-bold text-slate-600">${count}</span>
        <div class="w-full max-w-[28px] bg-blue-600 hover:bg-blue-700 rounded-t-lg transition-all" style="height: ${heightPct}%"></div>
        <span class="text-[10px] font-bold text-slate-400 mt-1">${dayLabels[idx]}</span>
      </div>`;
  }).join('');
}