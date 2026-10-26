-- Caja de asaditos (caja-asaditos.html). Cada ticket es una fila; el JSON de asaditos_v2_app_state
-- no se toca, así el sistema de control y la caja no se pisan al guardar.
-- Solo se accede por la edge function asaditos-v2-api (service role): RLS sin políticas.
create table if not exists public.asaditos_v2_ventas (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.asaditos_v2_accounts(id) on delete cascade,
  fecha date not null,
  items jsonb not null,          -- [{id, nombre, precio, cant}]
  total numeric not null,
  metodo text not null check (metodo in ('ef','pos','tr','py','mo')),
  anulada boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists asaditos_v2_ventas_fecha on public.asaditos_v2_ventas (account_id, fecha);
alter table public.asaditos_v2_ventas enable row level security;
revoke all on public.asaditos_v2_ventas from anon, authenticated;
