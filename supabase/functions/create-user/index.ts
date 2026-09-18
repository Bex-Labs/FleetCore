/**
 * EDGE FUNCTION: create-user
 * Creates a new staff account and sends a credential welcome email via Brevo.
 * Roles: company_admin | driver | maintenance_officer | account_manager
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY');
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDER_EMAIL  = Deno.env.get('SENDER_EMAIL') || Deno.env.get('FROM_EMAIL') || 'noreply@fleetcore.app';
const SENDER_NAME   = Deno.env.get('SENDER_NAME') || 'FleetCore Accounts';
const APP_URL       = Deno.env.get('APP_URL') || 'https://fleetcore.vercel.app';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ROLE_LABELS: Record<string, string> = {
  company_admin:       'Company Admin',
  driver:              'Driver',
  maintenance_officer: 'Maintenance Officer',
  account_manager:     'Account Manager',
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

    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .single();

    if (!callerProfile || (callerProfile.role !== 'company_admin' && callerProfile.role !== 'bex_admin')) {
      throw new Error('Only Company Admins and Bex Admins can provision staff accounts.');
    }

    const { email, full_name, role, phone_number, organization_id } = await req.json();
    if (!ROLE_LABELS[role]) throw new Error('Invalid staff role specified.');

    let targetOrgId = callerProfile.organization_id;
    if (callerProfile.role === 'bex_admin') {
      if (!organization_id) throw new Error('organization_id is required when Bex Admin creates a user.');
      targetOrgId = organization_id;
    }

    const tempPassword = crypto.randomUUID().slice(0, 10) + 'Fc!';

    const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name, role, organization_id: targetOrgId },
    });
    if (createErr) throw createErr;

    await supabaseAdmin.from('profiles').upsert({
      id: newUser.user.id,
      full_name,
      email,
      role,
      phone_number: phone_number || null,
      organization_id: targetOrgId,
      status: 'active',
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });

    // Send transactional welcome email via Brevo
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
          to: [{ email, name: full_name }],
          subject: `Welcome to FleetCore — Your ${ROLE_LABELS[role]} Account`,
          htmlContent: `
            <div style="font-family: Arial, sans-serif; max-width: 580px; margin: 0 auto; color: #1e293b; line-height: 1.6;">
              <h2 style="color: #0B2545; margin-bottom: 8px;">Welcome to FleetCore</h2>
              <p>Hi <strong>${full_name}</strong>,</p>
              <p>Your <strong>${ROLE_LABELS[role]}</strong> account has been provisioned on the platform.</p>
              <div style="background: #f1f5f9; border-left: 4px solid #00A896; padding: 16px; margin: 20px 0; border-radius: 4px;">
                <p style="margin: 0; font-size: 13px; color: #64748b;">Temporary Access Credentials:</p>
                <p style="margin: 4px 0 0 0; font-family: monospace; font-size: 16px; font-weight: bold; color: #0f172a;">${tempPassword}</p>
              </div>
              <p>Log in to your designated terminal and update your password immediately upon first sign-in:</p>
              <p style="margin: 24px 0;">
                <a href="${APP_URL}" style="background-color: #00A896; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Access FleetCore</a>
              </p>
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
              <p style="font-size: 11px; color: #94a3b8;">This automated transmission contains authorized operational access credentials.</p>
            </div>
          `,
        }),
      });

      if (!emailRes.ok) {
        const errBody = await emailRes.text();
        console.error('Brevo welcome email failed:', errBody);
      }
    }

    return new Response(JSON.stringify({ success: true, user_id: newUser.user.id }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});