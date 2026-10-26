-- Conteo de efectivo hecho en la Caja de asaditos (conteo ciego: el empleado no ve el esperado).
-- El último conteo de la noche es el que se muestra en el arqueo del sistema de asaditos.
create table if not exists public.asaditos_v2_conteos (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.asaditos_v2_accounts(id) on delete cascade,
  fecha date not null,
  billetes jsonb not null,       -- {"100000": 2, "50000": 1, ...}
  total numeric not null,
  usuario text not null,
  created_at timestamptz not null default now()
);
create index if not exists asaditos_v2_conteos_fecha on public.asaditos_v2_conteos (account_id, fecha, created_at desc);
alter table public.asaditos_v2_conteos enable row level security;
revoke all on public.asaditos_v2_conteos from anon, authenticated;
