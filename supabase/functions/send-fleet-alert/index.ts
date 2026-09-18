/**
 * EDGE FUNCTION: send-fleet-alert
 * Dispatches automated fleet alerts via Brevo:
 *  - "expiry"   : Scans roadworthiness, insurance, and license expiries within 14 days (Cron).
 *  - "incident" : Instant crisis notification dispatched to Company Admins on SOS/Incident insert.
 *
 * Body: { type: 'expiry' | 'incident', org_id?, incident_id? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY');
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDER_EMAIL  = Deno.env.get('SENDER_EMAIL') || Deno.env.get('FROM_EMAIL') || 'noreply@fleetcore.app';
const SENDER_NAME   = Deno.env.get('SENDER_NAME') || 'FleetCore Alerts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function sendEmail(to: string, subject: string, html: string) {
  if (!BREVO_API_KEY) {
    console.warn('BREVO_API_KEY not configured. Skipping alert email to:', to);
    return;
  }

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_API_KEY,
      'Content-Type': 'application/json',
      'accept': 'application/json'
    },
    body: JSON.stringify({
      sender: { email: SENDER_EMAIL, name: SENDER_NAME },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`Brevo alert failed for ${to}:`, errBody);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { type, incident_id } = await req.json();

    // 1. Expiry Scan Handler
    if (type === 'expiry') {
      const cutoff = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

      const { data: vehicles } = await supabaseAdmin
        .from('vehicles')
        .select('plate_number, roadworthiness_expiry, insurance_expiry, organization_id')
        .or(`roadworthiness_expiry.lte.${cutoff},insurance_expiry.lte.${cutoff}`);

      const { data: drivers } = await supabaseAdmin
        .from('profiles')
        .select('full_name, license_expiry, organization_id')
        .eq('role', 'driver')
        .lte('license_expiry', cutoff);

      const orgIds = [...new Set([...(vehicles || []), ...(drivers || [])].map((r: any) => r.organization_id))];

      for (const oid of orgIds) {
        const { data: admins } = await supabaseAdmin
          .from('profiles')
          .select('email, full_name')
          .eq('organization_id', oid)
          .eq('role', 'company_admin');

        const vList = (vehicles || []).filter((v: any) => v.organization_id === oid);
        const dList = (drivers || []).filter((d: any) => d.organization_id === oid);

        const html = `
          <div style="font-family: Arial, sans-serif; color: #0f172a; max-width: 580px;">
            <h3 style="color: #b45309;">Fleet Compliance Expiry Warning</h3>
            <p>The following vehicle documents or driver licenses expire within 14 days:</p>
            <ul>
              ${vList.map((v: any) => `<li><strong>Vehicle ${v.plate_number}</strong>: Roadworthiness/Insurance expiring</li>`).join('')}
              ${dList.map((d: any) => `<li><strong>Driver ${d.full_name}</strong>: Driver license expiring</li>`).join('')}
            </ul>
            <p>Please update registrations in your FleetCore Admin console.</p>
          </div>`;

        for (const admin of admins || []) {
          if (admin.email) {
            await sendEmail(admin.email, 'FleetCore Compliance: 14-Day Document Expiry Alert', html);
          }
        }
      }
    }

    // 2. Real-Time Crisis / Incident Dispatch Handler
    if (type === 'incident' && incident_id) {
      const { data: incident } = await supabaseAdmin
        .from('incidents')
        .select(`
          *,
          vehicle:vehicles(plate_number),
          driver:profiles(full_name, phone_number)
        `)
        .eq('id', incident_id)
        .single();

      if (incident) {
        const { data: admins } = await supabaseAdmin
          .from('profiles')
          .select('email')
          .eq('organization_id', incident.organization_id)
          .eq('role', 'company_admin');

        const incidentDesc = incident.description || incident.details || 'No descriptive payload';
        const plate = incident.vehicle?.plate_number || 'Unassigned Unit';
        const driverName = incident.driver?.full_name || 'Driver';

        const html = `
          <div style="font-family: Arial, sans-serif; color: #0f172a; max-width: 580px;">
            <div style="background: #dc2626; color: white; padding: 12px 16px; border-radius: 8px; font-weight: bold;">
              CRISIS ALERT: ${String(incident.incident_type || 'EMERGENCY').toUpperCase()}
            </div>
            <p style="margin-top: 16px;">An in-cab emergency trigger was activated:</p>
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
              <tr><td style="padding: 6px 0; color: #64748b;">Severity:</td><td style="font-weight: bold; text-transform: uppercase;">${incident.severity}</td></tr>
              <tr><td style="padding: 6px 0; color: #64748b;">Vehicle:</td><td style="font-weight: bold;">${plate}</td></tr>
              <tr><td style="padding: 6px 0; color: #64748b;">Driver:</td><td style="font-weight: bold;">${driverName}</td></tr>
              <tr><td style="padding: 6px 0; color: #64748b;">Details:</td><td>${incidentDesc}</td></tr>
            </table>
            <p style="margin-top: 20px;">Open your Admin or Bex Crisis Oversight center to coordinate emergency response.</p>
          </div>`;

        for (const admin of admins || []) {
          if (admin.email) {
            await sendEmail(admin.email, `URGENT: ${incident.incident_type} SOS Reported (${plate})`, html);
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});