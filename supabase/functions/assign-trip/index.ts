/**
 * EDGE FUNCTION: assign-trip
 * Assigns a vehicle + driver to a trip — runs with service role to bypass RLS.
 * Called by Company Admin when dispatching a trip.
 *
 * Body: { trip_id, vehicle_id, driver_id, org_id }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY');
const SENDER_EMAIL  = Deno.env.get('SENDER_EMAIL') || Deno.env.get('FROM_EMAIL') || 'noreply@fleetcore.app';
const SENDER_NAME   = Deno.env.get('SENDER_NAME') || 'FleetCore Dispatch';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('No authorization header.');

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) throw new Error('Not authenticated.');

    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .single();

    if (!callerProfile || (callerProfile.role !== 'company_admin' && callerProfile.role !== 'bex_admin')) {
      throw new Error('Only authorized admins can assign trips.');
    }

    const { trip_id, vehicle_id, driver_id, org_id } = await req.json();
    const targetOrgId = org_id || callerProfile.organization_id;

    if (callerProfile.role !== 'bex_admin' && targetOrgId !== callerProfile.organization_id) {
      throw new Error('Organization mismatch.');
    }

    const { error: updateErr } = await supabaseAdmin
      .from('trips')
      .update({ vehicle_id, driver_id, status: 'pending' })
      .eq('id', trip_id)
      .eq('organization_id', targetOrgId);

    if (updateErr) throw updateErr;

    // In-app notification
    await supabaseAdmin.from('notifications').insert({
      organization_id: targetOrgId,
      user_id: driver_id,
      title: 'New Trip Assigned',
      message: 'You have been dispatched on a new route assignment. Open your driver dashboard to inspect the manifest.',
      type: 'trip',
    });

    // Optional email notification to the driver
    if (BREVO_API_KEY && driver_id) {
      const { data: driver } = await supabaseAdmin
        .from('profiles')
        .select('email, full_name')
        .eq('id', driver_id)
        .single();

      if (driver?.email) {
        await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': BREVO_API_KEY,
            'Content-Type': 'application/json',
            'accept': 'application/json'
          },
          body: JSON.stringify({
            sender: { email: SENDER_EMAIL, name: SENDER_NAME },
            to: [{ email: driver.email, name: driver.full_name || 'Driver' }],
            subject: 'FleetCore: New Trip Dispatched',
            htmlContent: `
              <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #0f172a;">
                <h3 style="color: #00A896;">New Trip Assignment</h3>
                <p>Hello ${driver.full_name || 'Driver'},</p>
                <p>A new trip has been dispatched to your terminal account.</p>
                <p>Please log in to your Driver Console to complete pre-trip inspection and commence route.</p>
              </div>
            `,
          }),
        }).catch((e) => console.warn('Brevo dispatch email note:', e));
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});