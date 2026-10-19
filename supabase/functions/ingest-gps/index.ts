/**
 * EDGE FUNCTION: ingest-gps
 * Telematics ingestion gateway for SinoTrack hardware (via Flespi or Traccar).
 * Maps tracker IMEI/Unit ID to vehicle/bus, updates live coordinates,
 * and appends historical breadcrumbs to telemetry_logs.
 *
 * Supported payload shapes:
 * - Traccar standard webhook: { device: { uniqueId }, position: { latitude, longitude, speed, course, altitude, attributes } }
 * - Flespi HTTP stream: [ { "ident": "...", "position.latitude": ..., "position.longitude": ... } ]
 * - Direct REST: { imei: "...", lat: 9.082, lng: 8.675, speed: 45, ignition: true }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json();

    // 1. Normalize payload across different telematics forwarders
    let imei: string | null = null;
    let lat: number | null = null;
    let lng: number | null = null;
    let speed: number = 0;
    let course: number = 0;
    let altitude: number = 0;
    let batteryLevel: number | null = null;
    let satellites: number | null = null;
    let recordedAt: string = new Date().toISOString();
    let ignition: boolean = true;

    if (Array.isArray(body) && body.length > 0) {
      // Flespi stream format
      const msg = body[0];
      imei = String(msg.ident || msg['device.id'] || '');
      lat = Number(msg['position.latitude'] ?? msg.lat);
      lng = Number(msg['position.longitude'] ?? msg.lon);
      speed = Number(msg['position.speed'] ?? msg.speed ?? 0);
      course = Number(msg['position.direction'] ?? 0);
      altitude = Number(msg['position.altitude'] ?? 0);
      batteryLevel = msg['battery.level'] !== undefined ? Number(msg['battery.level']) : null;
      satellites = msg['position.satellites'] !== undefined ? Number(msg['position.satellites']) : null;
      recordedAt = msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : recordedAt;

      // Active if movement detected, wired ACC on, or receiving live stream packets
      const rawIgnition = msg['engine.ignition.status'];
      ignition = rawIgnition === true || speed > 0 || true;
    } else if (body.device && body.position) {
      // Traccar forward.url webhook format
      imei = String(body.device.uniqueId || '');
      lat = Number(body.position.latitude);
      lng = Number(body.position.longitude);
      speed = Number(body.position.speed ?? 0);
      course = Number(body.position.course ?? 0);
      altitude = Number(body.position.altitude ?? 0);
      batteryLevel = body.position.attributes?.batteryLevel !== undefined 
        ? Number(body.position.attributes.batteryLevel) 
        : null;
      satellites = body.position.attributes?.sat !== undefined 
        ? Number(body.position.attributes.sat) 
        : null;
      recordedAt = body.position.deviceTime || body.position.fixTime || recordedAt;

      // Ensure battery-operated SinoTrack units without an ACC wire stay visible on radar
      const rawIgnition = body.position.attributes?.ignition;
      ignition = rawIgnition === true || speed > 0 || true;
    } else {
      // Direct REST payload format
      imei = String(body.imei || body.tracker_imei || body.uniqueId || '');
      lat = Number(body.lat ?? body.latitude);
      lng = Number(body.lng ?? body.longitude);
      speed = Number(body.speed ?? 0);
      course = Number(body.course ?? body.heading ?? 0);
      altitude = Number(body.altitude ?? 0);
      batteryLevel = body.battery_level !== undefined ? Number(body.battery_level) : null;
      satellites = body.satellites !== undefined ? Number(body.satellites) : null;
      recordedAt = body.timestamp || recordedAt;

      const rawIgnition = body.ignition;
      ignition = rawIgnition === true || speed > 0 || true;
    }

    if (!imei || isNaN(Number(lat)) || isNaN(Number(lng))) {
      return new Response(JSON.stringify({ error: 'Missing valid IMEI or coordinates.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Resolve Vehicle by tracker_imei
    const { data: vehicle, error: vehicleErr } = await supabaseAdmin
      .from('vehicles')
      .select('id, organization_id, plate_number')
      .eq('tracker_imei', imei)
      .maybeSingle();

    if (vehicleErr || !vehicle) {
      return new Response(JSON.stringify({ error: `Unregistered tracker IMEI: ${imei}` }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Upsert live position into vehicle_locations (for realtime map subscriptions)
    const { error: locationErr } = await supabaseAdmin
      .from('vehicle_locations')
      .upsert({
        vehicle_id: vehicle.id,
        organization_id: vehicle.organization_id,
        lat,
        lng,
        speed,
        is_active: ignition,
        last_updated: recordedAt,
      }, { onConflict: 'vehicle_id' });

    if (locationErr) throw locationErr;

    // 4. Insert breadcrumb point into telemetry_logs (for trip route history & playback)
    const { error: logErr } = await supabaseAdmin
      .from('telemetry_logs')
      .insert({
        vehicle_id: vehicle.id,
        imei,
        latitude: lat,
        longitude: lng,
        speed,
        course,
        altitude,
        battery_level: batteryLevel,
        satellites,
        is_valid: true,
        recorded_at: recordedAt,
      });

    if (logErr) {
      console.error('telemetry_logs insert error:', logErr.message);
    }

    return new Response(JSON.stringify({
      success: true,
      vehicle_id: vehicle.id,
      plate_number: vehicle.plate_number,
      is_active: ignition,
      timestamp: recordedAt
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});