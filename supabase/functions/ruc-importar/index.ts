// Importa el padrón oficial de RUC de la DNIT (rucN.zip, N = 0..9) a la tabla ruc_padron.
// POST {archivo: N}. Autoriza con x-hook-secret (push_config) o un usuario logueado.
// Corre en segundo plano y deja el resultado en ruc_padron_log.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { unzipSync } from "npm:fflate@0.8.2";

const PAGINA = "https://www.dnit.gov.py/web/portal-institucional/listado-de-ruc-con-sus-equivalencias";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-hook-secret",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function importar(db: ReturnType<typeof createClient>, n: number) {
  const log = (estado: string, filas: number | null, detalle = "") =>
    db.from("ruc_padron_log").upsert({ archivo: n, estado, filas, detalle, updated_at: new Date().toISOString() });
  try {
    await log("descargando", null);
    const html = await (await fetch(PAGINA, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
    const m = html.match(new RegExp(`href="([^"]*/ruc${n}\\.zip[^"]*)"`, "i"));
    if (!m) throw new Error("No encontré el link de ruc" + n + ".zip");
    const url = new URL(m[1].replace(/&amp;/g, "&"), PAGINA).href;
    const zip = new Uint8Array(await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })).arrayBuffer());
    const files = unzipSync(zip);
    const nombre = Object.keys(files).find((f) => /\.txt$/i.test(f)) || Object.keys(files)[0];
    const bytes = files[nombre];
    let txt = new TextDecoder("utf-8").decode(bytes);
    if ((txt.match(/\uFFFD/g) || []).length > 20) txt = new TextDecoder("windows-1252").decode(bytes);

    // Formato: RUC|RAZON SOCIAL|DV|RUC ANTERIOR|ESTADO|
    // El parseo lo hace Postgres (ruc_padron_cargar): acá solo se corta en bloques por líneas,
    // para no superar el límite de CPU de la función.
    await log("importando", null);
    let filas = 0, i = 0;
    while (i < txt.length) {
      let j = Math.min(txt.length, i + 3_000_000);
      if (j < txt.length) { const k = txt.indexOf("\n", j); j = k < 0 ? txt.length : k + 1; }
      const { data, error } = await db.rpc("ruc_padron_cargar", { p_txt: txt.slice(i, j) });
      if (error) throw new Error(error.message);
      filas += Number(data) || 0;
      i = j;
      await log("importando", filas);
    }
    await log("ok", (txt.match(/\n/g) || []).length, nombre);
  } catch (e) {
    await log("error", null, String((e as Error).message || e));
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: cfg } = await db.from("push_config").select("hook_secret").eq("id", 1).single();
  let ok = !!cfg && req.headers.get("x-hook-secret") === cfg.hook_secret;
  if (!ok) {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer /i, "");
    const { data } = jwt ? await db.auth.getUser(jwt) : { data: null };
    ok = !!data?.user;
  }
  if (!ok) return json({ error: "no autorizado" }, 401);
  const body = await req.json().catch(() => ({}));
  const n = Number(body.archivo);
  if (!Number.isInteger(n) || n < 0 || n > 9) return json({ error: "archivo 0..9" }, 400);
  // @ts-ignore EdgeRuntime existe en Supabase
  EdgeRuntime.waitUntil(importar(db, n));
  return json({ ok: true, archivo: n });
});
