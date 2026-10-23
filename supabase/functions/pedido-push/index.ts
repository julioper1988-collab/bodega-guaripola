// Envía notificación push a los dispositivos suscriptos cuando entra un pedido online.
// Llamada por el trigger pedidos_push_after_insert (header x-hook-secret)
// o desde la app con sesión iniciada para enviar una prueba ({prueba:true}).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-hook-secret",
};
const fmt = (n: number) => "Gs. " + Math.round(Number(n) || 0).toLocaleString("es-PY");
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: cfg } = await db.from("push_config").select("*").eq("id", 1).single();
  if (!cfg) return json({ error: "sin config" }, 500);

  const body = await req.json().catch(() => ({}));
  let autorizado = req.headers.get("x-hook-secret") === cfg.hook_secret;
  if (!autorizado) {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer /i, "");
    const { data } = jwt ? await db.auth.getUser(jwt) : { data: null };
    autorizado = !!data?.user;
  }
  if (!autorizado) return json({ error: "no autorizado" }, 401);

  let payload: Record<string, unknown>;
  if (body.prueba) {
    payload = { title: "🔔 Prueba de avisos", body: "Así te van a llegar los pedidos nuevos.", tag: "prueba", url: "./index.html#pedidos" };
  } else {
    const { data: p } = await db.from("pedidos_online").select("*").eq("id", body.pedido_id).single();
    if (!p) return json({ error: "pedido no encontrado" }, 404);
    const partes = [];
    if (Number(p.total_asadito) > 0) partes.push("🔥 " + fmt(p.total_asadito));
    if (Number(p.total_bodega) > 0) partes.push("🛒 " + fmt(p.total_bodega));
    payload = {
      title: `🛵 Pedido nuevo #${p.numero} · ${fmt(p.total)}`,
      body: `${p.cliente_nombre} · ${p.entrega === "delivery" ? "Delivery" : "Retiro"} · ${partes.join(" + ")}`,
      tag: "pedido-" + p.numero,
      url: "./index.html#pedidos",
    };
  }

  webpush.setVapidDetails("mailto:avisos@guaripola.com", cfg.vapid_public, cfg.vapid_private);
  const { data: subs } = await db.from("push_suscripciones").select("*");
  let enviados = 0;
  await Promise.all((subs || []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600, urgency: "high" });
      enviados++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_suscripciones").delete().eq("id", s.id);
      console.error("push error", code, (e as Error).message);
    }
  }));
  return json({ ok: true, enviados, total: (subs || []).length });
});
