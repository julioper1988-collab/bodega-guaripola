-- Datos del comercio (marca): nombre, RUC, dirección, teléfono, logo y color.
-- Opcional: sin esta tabla la marca se guarda solo en cada dispositivo.
-- Con esta tabla se comparte entre todos los equipos y se ve en la pantalla de ingreso.
create table if not exists public.bodega_config (
  id int primary key default 1 check (id = 1),
  nombre text not null default 'Bodega Guaripola',
  lema text,
  ruc text,
  direccion text,
  telefono text,
  logo text,           -- imagen chica en base64 (data:image/png;base64,...)
  color text,          -- color principal, ej. #ef6a24
  updated_at timestamptz not null default now()
);
insert into public.bodega_config (id) values (1) on conflict do nothing;

alter table public.bodega_config enable row level security;
-- Lectura pública: la pantalla de ingreso muestra nombre y logo antes de iniciar sesión.
drop policy if exists config_lectura on public.bodega_config;
create policy config_lectura on public.bodega_config for select to anon, authenticated using (true);
-- Escritura: solo usuarios con sesión.
drop policy if exists config_escritura on public.bodega_config;
create policy config_escritura on public.bodega_config for all to authenticated using (true) with check (true);
grant select on public.bodega_config to anon;
grant select, insert, update on public.bodega_config to authenticated;
