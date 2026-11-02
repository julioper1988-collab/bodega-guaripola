-- Aplicado en Supabase. Pollería en los pedidos online: productos propios, horario propio y caja aparte (como el asadito).
create table if not exists public.pedidos_polleria (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  precio numeric not null check (precio > 0),
  activo boolean not null default true,
  vender_online boolean not null default true,
  disponible boolean not null default true,   -- «Agotado» se marca a mano en Catálogo online
  imagen_url text,
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.pedidos_polleria enable row level security;
revoke all on public.pedidos_polleria from anon;
create policy pedidos_polleria_auth on public.pedidos_polleria for all to authenticated using (true) with check (true);

alter table public.pedidos_online add column if not exists total_polleria numeric not null default 0;
alter table public.pedidos_online add column if not exists descuento_polleria numeric not null default 0;

-- pedidos_catalogo(): agrega 'polleria' (productos activos y online) y config.abierto_polleria.
-- pedidos_crear(): acepta items con origen 'polleria' (precio de pedidos_polleria, no van en combos),
--   controla su horario (horarios->'polleria'), y guarda total_polleria / descuento_polleria aparte;
--   el total, el pedido mínimo y los descuentos los incluyen. La venta automática de la bodega no los toma.
-- Parches aplicados con replace() sobre las definiciones vigentes (ver migración «pedidos_polleria»).
