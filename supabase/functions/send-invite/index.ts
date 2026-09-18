/**
 * EDGE FUNCTION: send-invite
 * Sends an organization onboarding invitation with pre-filled tenant code via Brevo.
 * Called from admin team management workflows.
 *
 * Body: { email, role, org_id? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY');
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDER_EMAIL  = Deno.env.get('SENDER_EMAIL') || Deno.env.get('FROM_EMAIL') || 'noreply@fleetcore.app';
const SENDER_NAME   = Deno.env.get('SENDER_NAME') || 'FleetCore Invitations';
const APP_URL       = Deno.env.get('APP_URL') || 'https://fleetcore.vercel.app';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_KEY);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('No authorization header.');

    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) throw new Error('Not authenticated.');

    const { data: caller } = await supabaseAdmin
      .from('profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .single();

    if (!caller || (caller.role !== 'company_admin' && caller.role !== 'bex_admin')) {
      throw new Error('Only Company Admins or Bex Admins can send invitations.');
    }

    const { email, role, org_id } = await req.json();
    if (!email) throw new Error('Recipient email is required.');

    const targetOrgId = org_id || caller.organization_id;
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('name, company_code, subdomain')
      .eq('id', targetOrgId)
      .single();

    const companyCode = org?.company_code || org?.subdomain || 'FC-ORG';
    const orgName = org?.name || 'Your Fleet Organization';
    const cleanRole = (role || 'staff').replace(/_/g, ' ');

    if (BREVO_API_KEY) {
      const emailRes = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': BREVO_API_KEY,
          'Content-Type': 'application/json',
          'accept': 'application/json'
        },
        body: JSON.stringify({
          sender: { email: SENDER_EMAIL, name: SENDER_NAME },
          to: [{ email }],
          subject: `Invitation to join ${orgName} on FleetCore`,
          htmlContent: `
            <div style="font-family: Arial, sans-serif; max-width: 580px; margin: 0 auto; color: #1e293b; line-height: 1.6;">
              <h2 style="color: #0B2545;">FleetCore Team Invitation</h2>
              <p>You have been invited to join <strong>${orgName}</strong> as a <strong>${cleanRole}</strong>.</p>
              <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b;">Your Company Code:</p>
                <p style="margin: 4px 0 0 0; font-family: monospace; font-size: 18px; font-weight: bold; color: #00A896;">${companyCode}</p>
              </div>
              <p>Click below to register your account using your email and company code:</p>
              <p style="margin: 24px 0;">
                <a href="${APP_URL}?code=${companyCode}&email=${encodeURIComponent(email)}" style="background-color: #0B2545; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Accept Invitation & Register</a>
              </p>
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
              <p style="font-size: 11px; color: #94a3b8;">If you did not anticipate this invitation, you can safely disregard this email.</p>
            </div>
          `,
        }),
      });

      if (!emailRes.ok) {
        const errBody = await emailRes.text();
        console.error('Brevo invite delivery failed:', errBody);
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