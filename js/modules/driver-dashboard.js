/**
 * DRIVER-DASHBOARD.JS — Real-time telemetry, 3-way crisis triggers, 
 * hardware GPS conflict guarding, displacement throttles, and unit synchronization.
 */

import { supabase, getUserProfile, formatDate, escapeHtml, createTileLayer } from '../config.js';
import { showToast, performLogout } from '../auth.js';

let profile = null;
let activeTrip = null;
let assignedVehicle = null;
let map = null;
let marker = null;
let watchId = null;
let broadcastInterval = null;

let lastUpsertTime = 0;
let lastCoord = null;

const mapEl = document.getElementById('driver-map');
if (mapEl) initDashboard();

export async function initDashboard() {
  profile = await getUserProfile();
  if (!profile) return;

  const headerName = document.getElementById('header-driver-name');
  const greetingEl = document.getElementById('driver-greeting');
  const headerAvatar = document.getElementById('header-avatar');
  const sidebarInitial = document.getElementById('sidebar-initial');
  const sidebarName = document.getElementById('sidebar-name');
  const effectiveName = profile.full_name || 'Tissan Dave';

  if (headerName) headerName.textContent = effectiveName;
  if (sidebarName) sidebarName.textContent = effectiveName;
  if (greetingEl) greetingEl.textContent = `Hello, ${effectiveName.split(' ')[0]}`;

  const initials = effectiveName.split(/\s+/).map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'TD';
  if (headerAvatar) headerAvatar.textContent = initials;
  if (sidebarInitial) sidebarInitial.textContent = initials;

  // Resolve Organization Name
  let orgName = 'TransCore Logistics';
  if (profile.organization_id) {
    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', profile.organization_id)
      .maybeSingle();
    if (org?.name) orgName = org.name;
  }
  document.querySelectorAll('#fc-org-name').forEach(el => el.textContent = orgName);

  const dateEl = document.getElementById('driver-today-date');
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('en-NG', { 
      weekday: 'long', 
      day: '2-digit', 
      month: 'short', 
      year: 'numeric' 
    });
  }

  initMap();

  // 1. Road Emergency SOS (critical)
  setupSosButton('sos-btn', 'sos-progress', 'sos-label', 'road_accident', 'Road Emergency SOS', 'critical');

  // 2. Health / Medical SOS (high)
  setupSosButton('health-sos-btn', 'health-sos-progress', 'health-sos-label', 'medical', 'Medical Distress', 'high');

  // 3. Repair / Breakdown SOS (medium)
  setupSosButton('repair-sos-btn', 'repair-sos-progress', 'repair-sos-label', 'breakdown', 'Mechanical Breakdown', 'medium');
  
  await loadAssignedTrip();
  await loadBroadcastFeed();
  setupBroadcastListener();
  startGpsTracking();
}
window.initDashboard = initDashboard;

function initMap() {
  if (map || typeof L === 'undefined') return;

  map = L.map('driver-map', { zoomControl: false, attributionControl: false }).setView([9.0820, 8.6753], 15);
  const tileLayer = createTileLayer();
  if (tileLayer) tileLayer.addTo(map);

  const icon = L.divIcon({
    className: 'custom-driver-pin',
    html: `<div class="w-5 h-5 rounded-full bg-teal-600 border-2 border-white shadow-xl"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });

  marker = L.marker([9.0820, 8.6753], { icon }).addTo(map);
}

function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function startGpsTracking() {
  if (!navigator.geolocation) return;

  watchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const { latitude, longitude, speed } = pos.coords;
      const kmh = Math.round((speed || 0) * 3.6);
      const now = Date.now();

      const speedEl = document.getElementById('speed-val');
      const gpsStatus = document.getElementById('gps-status');
      const gpsStatusPill = document.getElementById('gps-status-pill');
      const coordsBadge = document.getElementById('coords-badge');

      if (speedEl) speedEl.innerHTML = `${kmh} <small class="text-[10px] font-normal text-slate-500">km/h</small>`;
      if (gpsStatus) gpsStatus.textContent = 'READY';
      if (gpsStatusPill) gpsStatusPill.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-teal-50 text-teal-700 border border-teal-200/60";
      if (coordsBadge) coordsBadge.textContent = `${latitude.toFixed(4)}°, ${longitude.toFixed(4)}°`;

      if (marker && map) {
        marker.setLatLng([latitude, longitude]);
        map.panTo([latitude, longitude], { animate: true });
      }

      // GUARD: If vehicle uses SinoTrack hardware, do not overwrite coordinates from mobile
      if (assignedVehicle?.tracking_source === 'hardware_gps' || assignedVehicle?.tracker_imei) {
        if (gpsStatus) gpsStatus.textContent = 'HARDWARE SYNC';
        return;
      }

      // DEBOUNCE: Only upsert if 3000ms elapsed AND moved at least 8 meters
      const hasMoved = !lastCoord || calculateDistanceMeters(lastCoord.lat, lastCoord.lng, latitude, longitude) >= 8;
      const timeElapsed = (now - lastUpsertTime) >= 3000;

      if (assignedVehicle?.id && hasMoved && timeElapsed) {
        lastUpsertTime = now;
        lastCoord = { lat: latitude, lng: longitude };

        await supabase.from('vehicle_locations').upsert({
          vehicle_id: assignedVehicle.id,
          driver_id: profile.id,
          organization_id: profile.organization_id,
          lat: latitude,
          lng: longitude,
          speed: kmh,
          is_active: true,
          last_updated: new Date().toISOString()
        }, { onConflict: 'vehicle_id' });
      }
    },
    (err) => {
      console.warn('GPS Error:', err.message);
      const gpsStatus = document.getElementById('gps-status');
      const gpsStatusPill = document.getElementById('gps-status-pill');
      if (gpsStatus) gpsStatus.textContent = 'OFFLINE';
      if (gpsStatusPill) gpsStatusPill.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200/60";
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 8000 }
  );
}

async function loadAssignedTrip() {
  const { data: trips } = await supabase
    .from('trips')
    .select('*, vehicle:vehicles(id, plate_number, make, model, tracking_source, tracker_imei)')
    .eq('driver_id', profile.id)
    .in('status', ['in_progress', 'pending'])
    .order('created_at', { ascending: false })
    .limit(1);

  activeTrip = trips?.[0] || null;

  const headerBadge = document.getElementById('header-vehicle-badge');
  const plateCard = document.getElementById('assigned-plate-card');
  const sidebarBus = document.getElementById('sidebar-bus');

  if (activeTrip?.vehicle) {
    assignedVehicle = activeTrip.vehicle;
    const plateText = assignedVehicle.plate_number;
    if (headerBadge) headerBadge.textContent = plateText;
    if (plateCard) plateCard.textContent = plateText;
    if (sidebarBus) sidebarBus.textContent = `BUS ${plateText} · ACTIVE`;
  } else {
    // Fallback check on vehicles table
    const { data: fallbackVehicle } = await supabase
      .from('vehicles')
      .select('id, plate_number, tracking_source, tracker_imei')
      .eq('assigned_driver_id', profile.id)
      .maybeSingle();

    if (fallbackVehicle) {
      assignedVehicle = fallbackVehicle;
      if (headerBadge) headerBadge.textContent = fallbackVehicle.plate_number;
      if (plateCard) plateCard.textContent = fallbackVehicle.plate_number;
      if (sidebarBus) sidebarBus.textContent = `BUS ${fallbackVehicle.plate_number}`;
    } else {
      if (headerBadge) headerBadge.textContent = 'STANDBY POOL';
      if (plateCard) plateCard.textContent = 'Unassigned';
      if (sidebarBus) sidebarBus.textContent = 'No bus assigned';
    }
  }

  const startBtn = document.getElementById('start-trip-btn');
  const startLabel = document.getElementById('start-btn-label');
  const checklistDone = localStorage.getItem('fc_pretrip_cleared') === new Date().toDateString();

  if (activeTrip) {
    if (activeTrip.status === 'in_progress') {
      startBtn.disabled = false;
      startBtn.className = startBtn.className.replace('bg-teal-600', 'bg-emerald-600');
      startLabel.textContent = 'Continue Active Route';
      startBtn.onclick = () => window.location.href = 'active-trip.html';
    } else if (checklistDone) {
      startBtn.disabled = false;
      startLabel.textContent = 'Start Scheduled Trip';
      startBtn.onclick = async () => {
        await supabase.from('trips').update({ status: 'in_progress', started_at: new Date().toISOString() }).eq('id', activeTrip.id);
        window.location.href = 'active-trip.html';
      };
    } else {
      startBtn.disabled = true;
      startLabel.textContent = 'Start Trip (Pre-Trip Inspection Required)';
    }
  } else {
    startBtn.disabled = true;
    startLabel.textContent = 'No Assigned Trip On Standby';
  }
}

function setupSosButton(btnId, progressId, labelId, type, title, severity = 'high') {
  const btn = document.getElementById(btnId);
  const progress = document.getElementById(progressId);
  const label = document.getElementById(labelId);
  if (!btn) return;

  const originalText = label ? label.textContent : '';
  let timer = null;
  let startTime = 0;

  const startHold = (e) => {
    e.preventDefault();
    startTime = Date.now();
    btn.classList.add('holding');
    timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      progress.style.width = `${Math.min((elapsed / 5000) * 100, 100)}%`;
      if (elapsed >= 5000) {
        clearInterval(timer);
        fireSOS(type, title, btn, label, originalText, severity);
        progress.style.width = '0%';
        btn.classList.remove('holding');
      }
    }, 100);
  };

  const clearHold = () => {
    clearInterval(timer);
    btn.classList.remove('holding');
    progress.style.width = '0%';
  };

  btn.addEventListener('mousedown', startHold);
  btn.addEventListener('touchstart', startHold, { passive: false });
  btn.addEventListener('mouseup', clearHold);
  btn.addEventListener('mouseleave', clearHold);
  btn.addEventListener('touchend', clearHold);
}

async function fireSOS(type, title, btn, label, originalText, severity = 'high') {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported on this device.', 'error');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;

      const { error } = await supabase.from('incidents').insert({
        organization_id: profile.organization_id,
        driver_id: profile.id,
        vehicle_id: assignedVehicle?.id || null,
        trip_id: activeTrip?.id || null,
        incident_type: type,
        severity: severity,
        latitude,
        longitude,
        status: 'open',
        description: `In-cab trigger: Driver dispatched ${title}.`
      });

      if (error) {
        showToast(`Failed to transmit SOS: ${error.message}`, 'error');
        return;
      }

      if (label) label.textContent = 'ALERT SENT';
      showToast(`${title} transmitted to Fleet Control.`, 'success', 5000);
      setTimeout(() => {
        if (label) label.textContent = originalText;
      }, 4000);
    },
    (err) => {
      showToast(`GPS error: ${err.message}. Enabling standard location fallback.`, 'warning');
      
      supabase.from('incidents').insert({
        organization_id: profile.organization_id,
        driver_id: profile.id,
        vehicle_id: assignedVehicle?.id || null,
        trip_id: activeTrip?.id || null,
        incident_type: type,
        severity: severity,
        status: 'open',
        description: `In-cab trigger: Driver dispatched ${title} (GPS offline).`
      }).then(({ error }) => {
        if (!error) {
          if (label) label.textContent = 'ALERT SENT';
          showToast(`${title} transmitted to Fleet Control.`, 'success', 5000);
          setTimeout(() => {
            if (label) label.textContent = originalText;
          }, 4000);
        }
      });
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

async function loadBroadcastFeed() {
  const { data: logs } = await supabase
    .from('notifications')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false })
    .limit(5);

  const feed = document.getElementById('broadcast-history-feed');
  if (!logs?.length) return;

  feed.innerHTML = logs.map(item => `
    <div class="p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
      <div class="flex justify-between text-[10px] font-bold text-slate-500 mb-1">
        <span>${escapeHtml(item.title || 'SYSTEM DIRECTIVE')}</span>
        <span>${formatDate(item.created_at)}</span>
      </div>
      <p class="text-slate-800 font-medium">${escapeHtml(item.message)}</p>
    </div>`).join('');
}

function setupBroadcastListener() {
  supabase.channel('global-fleet-broadcast')
    .on('broadcast', { event: 'urgent-alert' }, ({ payload }) => triggerDirectiveModal(payload.message, 'Emergency Directive'))
    .subscribe();
}

function triggerDirectiveModal(msg, source) {
  document.getElementById('broadcast-modal-msg').textContent = msg;
  document.getElementById('broadcast-modal-source').textContent = source;
  document.getElementById('broadcast-modal').classList.remove('hidden');
  let seconds = 15;
  clearInterval(broadcastInterval);
  broadcastInterval = setInterval(() => {
    seconds--;
    document.getElementById('broadcast-countdown').textContent = seconds;
    document.getElementById('broadcast-timer-fill').style.width = `${(seconds / 15) * 100}%`;
    if (seconds <= 0) dismissBroadcastModal();
  }, 1000);
}

window.dismissBroadcastModal = function() {
  document.getElementById('broadcast-modal').classList.add('hidden');
  clearInterval(broadcastInterval);
};

document.getElementById('logout-btn')?.addEventListener('click', () => {
  if (confirm('Sign out from Driver Console?')) performLogout();
});