-- Mesas pendientes de la Caja de asaditos: cuentas abiertas que se cobran después.
-- Al cobrar se crea la venta (asaditos_v2_ventas) y la mesa queda cerrada con venta_id.
-- Borrar una mesa no la elimina: queda cerrada con borrada = true (para control).
create table if not exists public.asaditos_v2_mesas (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.asaditos_v2_accounts(id) on delete cascade,
  fecha date not null,
  nombre text not null,
  items jsonb not null,          -- [{id, nombre, precio, cant}]
  cerrada boolean not null default false,
  borrada boolean not null default false,
  venta_id uuid references public.asaditos_v2_ventas(id),
  usuario text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists asaditos_v2_mesas_abiertas on public.asaditos_v2_mesas (account_id) where not cerrada;
alter table public.asaditos_v2_mesas enable row level security;
revoke all on public.asaditos_v2_mesas from anon, authenticated;
-- asadito_stock() descuenta también los productos de mesas abiertas de la noche (ver sql/asaditos_stock.sql).
