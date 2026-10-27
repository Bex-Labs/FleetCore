/**
 * DRIVER-ACTIVE-TRIP.JS — Live in-progress navigation, speed telemetry,
 * throttled GPS coordinate broadcasts, and post-trip fuel gate.
 */

import { supabase, getUserProfile, createTileLayer } from '../config.js';
import { showToast } from '../auth.js';

let navMap = null;
let vehicleMarker = null;
let currentTrip = null;
let watchId = null;
let startTime = Date.now();
let currentPos = [9.0820, 8.6753];
let profile = null;

let lastNavUpsertTime = 0;
let lastNavCoord = null;

const mapEl = document.getElementById('active-nav-map');
if (mapEl) initNav();

async function initNav() {
  profile = await getUserProfile();
  if (!profile) return;

  const { data: trip } = await supabase
    .from('trips')
    .select('*, vehicle:vehicles(id, plate_number, tracking_source, tracker_imei)')
    .eq('driver_id', profile.id)
    .eq('status', 'in_progress')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  currentTrip = trip;

  if (currentTrip) {
    document.getElementById('nav-destination').textContent = currentTrip.destination || 'Target Depot';
    if (currentTrip.vehicle) {
      document.getElementById('nav-vehicle-plate').textContent = currentTrip.vehicle.plate_number;
    }
  }

  initMap();
  startNavStream();
  setInterval(updateTimer, 1000);
}

function initMap() {
  if (typeof L === 'undefined') return;

  navMap = L.map('active-nav-map', { zoomControl: false, attributionControl: false }).setView(currentPos, 16);
  const tileLayer = createTileLayer();
  if (tileLayer) tileLayer.addTo(navMap);

  const icon = L.divIcon({
    className: 'active-nav-pin',
    html: `<div class="w-5 h-5 rounded-full bg-emerald-500 border-2 border-white shadow-2xl"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });

  vehicleMarker = L.marker(currentPos, { icon }).addTo(navMap);
}

function startNavStream() {
  if (!navigator.geolocation) return;

  watchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const speedKm = Math.round((pos.coords.speed || 0) * 3.6);
      currentPos = [lat, lng];
      const now = Date.now();

      const speedEl = document.getElementById('telemetry-speed');
      if (speedEl) speedEl.textContent = speedKm;

      if (vehicleMarker && navMap) {
        vehicleMarker.setLatLng(currentPos);
        navMap.panTo(currentPos, { animate: true });
      }

      // GUARD: If vehicle uses hardware GPS, do not overwrite coordinates from mobile
      if (currentTrip?.vehicle?.tracking_source === 'hardware_gps' || currentTrip?.vehicle?.tracker_imei) {
        return;
      }

      // DEBOUNCE: Min 3000ms interval AND >= 8m displacement
      const dist = lastNavCoord 
        ? Math.hypot(lat - lastNavCoord.lat, lng - lastNavCoord.lng) * 111000 
        : 100;

      if (currentTrip?.vehicle_id && (now - lastNavUpsertTime >= 3000) && dist >= 8) {
        lastNavUpsertTime = now;
        lastNavCoord = { lat, lng };

        await supabase.from('vehicle_locations').upsert({
          vehicle_id: currentTrip.vehicle_id,
          driver_id: profile.id,
          organization_id: profile.organization_id,
          lat,
          lng,
          speed: speedKm,
          is_active: true,
          last_updated: new Date().toISOString()
        }, { onConflict: 'vehicle_id' });
      }
    },
    null,
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 8000 }
  );
}

window.centerVehicleOnMap = function() {
  if (navMap) navMap.setView(currentPos, 16, { animate: true });
};

window.fastTriggerSos = async function() {
  if (!confirm('Broadcast an immediate emergency SOS to Fleet Command?')) return;

  await supabase.from('incidents').insert({
    organization_id: profile.organization_id,
    driver_id: profile.id,
    vehicle_id: currentTrip?.vehicle_id || null,
    trip_id: currentTrip?.id || null,
    incident_type: 'sos',
    severity: 'critical',
    latitude: currentPos[0],
    longitude: currentPos[1],
    status: 'open',
    description: 'Urgent in-cab SOS triggered during active transit.'
  });

  showToast('SOS broadcasted. Fleet Control alerted.', 'success', 5000);
};

window.openEndTripModal = function() {
  document.getElementById('fuel-modal').classList.remove('hidden');
};

window.closeEndTripModal = function() {
  document.getElementById('fuel-modal').classList.add('hidden');
};

window.confirmEndTrip = async function() {
  const odom = document.getElementById('odometer-after').value;
  const fuel = document.getElementById('fuel-level-after').value;

  if (!odom) {
    showToast('Final odometer reading is required.', 'error');
    return;
  }

  if (watchId) navigator.geolocation.clearWatch(watchId);

  await supabase.from('trips').update({
    status: 'completed',
    completed_at: new Date().toISOString()
  }).eq('id', currentTrip.id);

  if (currentTrip.vehicle_id) {
    await supabase.from('fuel_logs').insert({
      organization_id: profile.organization_id,
      driver_id: profile.id,
      vehicle_id: currentTrip.vehicle_id,
      odometer_reading: parseInt(odom),
      fuel_level_percent: parseInt(fuel),
      notes: 'Post-trip fuel & odometer recorded.'
    });
  }

  localStorage.removeItem('fc_pretrip_cleared');
  showToast('Trip route completed successfully.', 'success');
  setTimeout(() => window.location.href = 'dashboard.html', 1200);
};

function updateTimer() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const hrs = String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const mins = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const secs = String(elapsed % 60).padStart(2, '0');
  const el = document.getElementById('nav-elapsed-time');
  if (el) el.textContent = `${hrs}:${mins}:${secs}`;
}