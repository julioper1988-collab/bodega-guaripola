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
    .select('id,account_id,expires_at,asaditos_v2_accounts!inner(username,active,rol,caja_de)')
    .eq('token_digest', digest)
    .maybeSingle();
  if (error || !data) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) {
    await db.from('asaditos_v2_sessions').delete().eq('id', data.id);
    return null;
  }
  const account = Array.isArray(data.asaditos_v2_accounts) ? data.asaditos_v2_accounts[0] : data.asaditos_v2_accounts;
  if (!account?.active) return null;
  // Usuario de caja: trabaja sobre la cuenta de su dueño (caja_de)
  const caja = account.rol === 'caja';
  return { sessionId: data.id, accountId: caja ? account.caja_de : data.account_id, username: account.username, caja };
}

// Arma las líneas de un ticket con nombre y precio del sistema (no del cliente)
async function armarItems(accountId: string, lineas: any[], vacioOk = false) {
  const { data: st, error } = await db.from('asaditos_v2_app_state').select('data').eq('account_id', accountId).maybeSingle();
  if (error) return { error: 'No se pudo cargar la base.' };
  const productos = new Map<string, any>((st?.data?.products ?? []).map((p: any) => [String(p.id), p]));
  // persona: 0 = sin asignar, 1 a 8 = cuenta separada de una mesa
  const items: { id: string; nombre: string; precio: number; cant: number; persona?: number }[] = [];
  for (const l of lineas) {
    const p = productos.get(String(l?.id));
    const cant = Number(l?.cant), persona = Number(l?.persona ?? 0);
    if (!p || !Number.isInteger(cant) || cant < 1 || cant > 999) return { error: 'Producto o cantidad inválida.' };
    if (!Number.isInteger(persona) || persona < 0 || persona > 8) return { error: 'Persona inválida.' };
    items.push({ id: String(p.id), nombre: String(p.name || ''), precio: Number(p.price) || 0, cant, ...(persona ? { persona } : {}) });
  }
  if (!items.length && !vacioOk) return { error: 'El ticket está vacío.' };
  return { items, total: items.reduce((a, x) => a + x.precio * x.cant, 0) };
}

const METODOS = ['ef', 'pos', 'tr', 'py', 'mo', 'ch', 'mi', 'ju'];
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

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
      .select('id,username,credential_digest,active,rol')
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

    return json({ ok: true, token, username: account.username, rol: account.rol, expires_at: expiresAt });
  }

  const token = String(body.token || '');
  const session = await requireSession(token);
  if (!session) return json({ error: 'Sesión vencida o inválida.' }, 401);
  if (session.caja && !['productos', 'venta', 'ventas', 'anular', 'conteo', 'mesa_guardar', 'mesa_cobrar', 'mesa_borrar', 'logout'].includes(action)) {
    return json({ error: 'Este usuario es solo para la caja.' }, 403);
  }

  // Para la caja: solo nombre y precio de los productos (sin costos ni días)
  if (action === 'productos') {
    const { data, error } = await db.from('asaditos_v2_app_state').select('data').eq('account_id', session.accountId).maybeSingle();
    if (error) return json({ error: 'No se pudo cargar la base.' }, 500);
    const productos = (data?.data?.products ?? []).filter((p: any) => p.active !== false)
      .map((p: any) => ({ id: p.id, name: p.name, price: p.price }));
    return json({ ok: true, productos });
  }

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

  // Caja de asaditos (caja-asaditos.html): un ticket por fila en asaditos_v2_ventas.
  // El precio sale de los productos del sistema, no del cliente.
  if (action === 'venta') {
    const fecha = String(body.fecha || '');
    const metodo = String(body.metodo || '');
    const lineas = Array.isArray(body.items) ? body.items : [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return json({ error: 'Fecha inválida.' }, 400);
    if (!METODOS.includes(metodo)) return json({ error: 'Método de pago inválido.' }, 400);
    const armado = await armarItems(session.accountId, lineas);
    if ('error' in armado) return json({ error: armado.error }, 400);
    const { items, total } = armado;
    const { data, error } = await db.from('asaditos_v2_ventas')
      .insert({ account_id: session.accountId, fecha, metodo, items, total })
      .select('id,fecha,items,total,metodo,anulada,created_at').single();
    if (error) return json({ error: 'No se pudo guardar la venta.' }, 500);
    return json({ ok: true, venta: data });
  }

  if (action === 'ventas') {
    const fecha = String(body.fecha || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return json({ error: 'Fecha inválida.' }, 400);
    const { data, error } = await db.from('asaditos_v2_ventas')
      .select('id,fecha,items,total,metodo,anulada,created_at')
      .eq('account_id', session.accountId).eq('fecha', fecha).order('created_at', { ascending: false });
    if (error) return json({ error: 'No se pudieron cargar las ventas.' }, 500);
    // Solo los agotados de la noche actual: la caja no muestra cuánto stock hay.
    const { data: stock } = await db.rpc('asadito_stock');
    const agotados = (stock ?? []).filter((s: any) => s.disponible !== null && s.disponible <= 0).map((s: any) => s.prod_id);
    const { data: conteo } = await db.from('asaditos_v2_conteos').select('total,billetes,usuario,created_at')
      .eq('account_id', session.accountId).eq('fecha', fecha).order('created_at', { ascending: false }).limit(1).maybeSingle();
    const { data: mesas } = await db.from('asaditos_v2_mesas').select('id,nombre,items,usuario,created_at,updated_at')
      .eq('account_id', session.accountId).eq('cerrada', false).order('created_at');
    return json({ ok: true, ventas: data, agotados, conteo, mesas: mesas ?? [] });
  }

  if (action === 'anular') {
    const { error } = await db.from('asaditos_v2_ventas').update({ anulada: true })
      .eq('account_id', session.accountId).eq('id', String(body.id || ''));
    if (error) return json({ error: 'No se pudo anular.' }, 500);
    return json({ ok: true });
  }

  // Conteo de efectivo desde la caja: billetes {denominación: cantidad}; el total lo calcula el servidor
  if (action === 'conteo') {
    const fecha = String(body.fecha || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return json({ error: 'Fecha inválida.' }, 400);
    const DENOM = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 100, 50];
    const billetes: Record<string, number> = {};
    let total = 0;
    for (const d of DENOM) {
      const n = Number(body.billetes?.[d] ?? 0);
      if (!Number.isInteger(n) || n < 0 || n > 9999) return json({ error: 'Cantidad inválida.' }, 400);
      if (n) { billetes[d] = n; total += d * n; }
    }
    const { data, error } = await db.from('asaditos_v2_conteos')
      .insert({ account_id: session.accountId, fecha, billetes, total, usuario: session.username })
      .select('total,billetes,usuario,created_at').single();
    if (error) return json({ error: 'No se pudo guardar el conteo.' }, 500);
    return json({ ok: true, conteo: data });
  }

  // Mesas pendientes: guardar (nueva o actualizar), cobrar (crea la venta) o borrar (queda registrada)
  if (action === 'mesa_guardar') {
    const fecha = String(body.fecha || '');
    const nombre = String(body.nombre || '').trim().slice(0, 40);
    if (!FECHA_RE.test(fecha)) return json({ error: 'Fecha inválida.' }, 400);
    if (!nombre) return json({ error: 'Poné un nombre a la mesa.' }, 400);
    const armado = await armarItems(session.accountId, Array.isArray(body.items) ? body.items : []);
    if ('error' in armado) return json({ error: armado.error }, 400);
    const cols = 'id,nombre,items,usuario,created_at,updated_at';
    const { data, error } = body.id
      ? await db.from('asaditos_v2_mesas').update({ nombre, items: armado.items, usuario: session.username, updated_at: new Date().toISOString() })
          .eq('account_id', session.accountId).eq('id', String(body.id)).eq('cerrada', false).select(cols).maybeSingle()
      : await db.from('asaditos_v2_mesas').insert({ account_id: session.accountId, fecha, nombre, items: armado.items, usuario: session.username })
          .select(cols).maybeSingle();
    if (error) return json({ error: 'No se pudo guardar la mesa.' }, 500);
    if (!data) return json({ error: 'Esa mesa ya fue cobrada o borrada.' }, 409);
    return json({ ok: true, mesa: data });
  }

  if (action === 'mesa_cobrar') {
    const fecha = String(body.fecha || '');
    const metodo = String(body.metodo || '');
    if (!FECHA_RE.test(fecha)) return json({ error: 'Fecha inválida.' }, 400);
    if (!METODOS.includes(metodo)) return json({ error: 'Método de pago inválido.' }, 400);
    const armado = await armarItems(session.accountId, Array.isArray(body.items) ? body.items : []);
    if ('error' in armado) return json({ error: armado.error }, 400);
    // resto: lo que queda sin cobrar (otras personas); si hay, la mesa sigue abierta con eso
    const resto = await armarItems(session.accountId, Array.isArray(body.resto) ? body.resto : [], true);
    if ('error' in resto) return json({ error: resto.error }, 400);
    // Se cierra primero (solo si sigue abierta): así dos celulares no la cobran dos veces
    const { data: mesa } = await db.from('asaditos_v2_mesas')
      .update({ cerrada: true, usuario: session.username, updated_at: new Date().toISOString() })
      .eq('account_id', session.accountId).eq('id', String(body.id || '')).eq('cerrada', false).select('id').maybeSingle();
    if (!mesa) return json({ error: 'Esa mesa ya fue cobrada o borrada.' }, 409);
    const { data: venta, error } = await db.from('asaditos_v2_ventas')
      .insert({ account_id: session.accountId, fecha, metodo, items: armado.items, total: armado.total })
      .select('id,fecha,items,total,metodo,anulada,created_at').single();
    if (error) {
      await db.from('asaditos_v2_mesas').update({ cerrada: false }).eq('id', mesa.id);
      return json({ error: 'No se pudo guardar la venta.' }, 500);
    }
    await db.from('asaditos_v2_mesas').update(resto.items.length ? { cerrada: false, items: resto.items, venta_id: venta.id } : { items: armado.items, venta_id: venta.id }).eq('id', mesa.id);
    return json({ ok: true, venta });
  }

  if (action === 'mesa_borrar') {
    const { error } = await db.from('asaditos_v2_mesas').update({ cerrada: true, borrada: true, usuario: session.username, updated_at: new Date().toISOString() })
      .eq('account_id', session.accountId).eq('id', String(body.id || '')).eq('cerrada', false);
    if (error) return json({ error: 'No se pudo borrar la mesa.' }, 500);
    return json({ ok: true });
  }

  if (action === 'logout') {
    await db.from('asaditos_v2_sessions').delete().eq('id', session.sessionId);
    return json({ ok: true });
  }

  return json({ error: 'Acción desconocida.' }, 400);
});
