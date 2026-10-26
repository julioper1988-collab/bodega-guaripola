import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import bcrypt from 'npm:bcryptjs@2.4.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function requireSession(token: string | undefined) {
  if (!token) return null;
  const digest = await sha256Hex(token);
  const { data, error } = await db
    .from('asaditos_v2_sessions')
    .select('id,account_id,expires_at,asaditos_v2_accounts!inner(username,active)')
    .eq('token_digest', digest)
    .maybeSingle();
  if (error || !data) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) {
    await db.from('asaditos_v2_sessions').delete().eq('id', data.id);
    return null;
  }
  const account = Array.isArray(data.asaditos_v2_accounts) ? data.asaditos_v2_accounts[0] : data.asaditos_v2_accounts;
  if (!account?.active) return null;
  return { sessionId: data.id, accountId: data.account_id, username: account.username };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const action = String(body.action || '');

  if (action === 'login') {
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!username || !password) return json({ error: 'Ingresá usuario y contraseña.' }, 400);

    const { data: account, error } = await db
      .from('asaditos_v2_accounts')
      .select('id,username,credential_digest,active')
      .eq('username', username)
      .maybeSingle();
    if (error || !account || !account.active || !bcrypt.compareSync(password, account.credential_digest)) {
      return json({ error: 'Usuario o contraseña incorrectos.' }, 401);
    }

    await db.from('asaditos_v2_sessions').delete().lt('expires_at', new Date().toISOString());
    const token = randomToken();
    const tokenDigest = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { error: sessionError } = await db.from('asaditos_v2_sessions').insert({
      account_id: account.id,
      token_digest: tokenDigest,
      expires_at: expiresAt,
    });
    if (sessionError) return json({ error: 'No se pudo crear la sesión.' }, 500);

    return json({ ok: true, token, username: account.username, expires_at: expiresAt });
  }

  const token = String(body.token || '');
  const session = await requireSession(token);
  if (!session) return json({ error: 'Sesión vencida o inválida.' }, 401);

  if (action === 'load') {
    const { data, error } = await db
      .from('asaditos_v2_app_state')
      .select('data,updated_at')
      .eq('account_id', session.accountId)
      .maybeSingle();
    if (error) return json({ error: 'No se pudo cargar la base.' }, 500);
    return json({ ok: true, username: session.username, data: data?.data ?? null, updated_at: data?.updated_at ?? null });
  }

  if (action === 'save') {
    const data = body.data;
    if (!data || typeof data !== 'object' || !Array.isArray(data.products) || typeof data.days !== 'object') {
      return json({ error: 'Formato de datos inválido.' }, 400);
    }
    const now = new Date().toISOString();
    const { error } = await db.from('asaditos_v2_app_state').upsert({
      account_id: session.accountId,
      data,
      updated_at: now,
    }, { onConflict: 'account_id' });
    if (error) return json({ error: 'No se pudo guardar.' }, 500);
    return json({ ok: true, updated_at: now });
  }

  if (action === 'change_password') {
    const currentPassword = String(body.current_password || '');
    const newPassword = String(body.new_password || '');
    if (newPassword.length < 5) return json({ error: 'La nueva contraseña debe tener al menos 5 caracteres.' }, 400);
    const { data: account, error } = await db.from('asaditos_v2_accounts').select('credential_digest').eq('id', session.accountId).single();
    if (error || !account || !bcrypt.compareSync(currentPassword, account.credential_digest)) {
      return json({ error: 'La contraseña actual no coincide.' }, 401);
    }
    const digest = bcrypt.hashSync(newPassword, 10);
    const { error: updateError } = await db.from('asaditos_v2_accounts').update({ credential_digest: digest, credential_salt: 'bcrypt', credential_iterations: 0, updated_at: new Date().toISOString() }).eq('id', session.accountId);
    if (updateError) return json({ error: 'No se pudo cambiar la contraseña.' }, 500);
    await db.from('asaditos_v2_sessions').delete().eq('account_id', session.accountId).neq('id', session.sessionId);
    return json({ ok: true });
  }

  if (action === 'logout') {
    await db.from('asaditos_v2_sessions').delete().eq('id', session.sessionId);
    return json({ ok: true });
  }

  return json({ error: 'Acción desconocida.' }, 400);
});
