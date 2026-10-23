-- Aplicado en Supabase. Padrón oficial de RUC de la DNIT para completar la razón social en pedidos.
-- Se importa con la Edge Function ruc-importar (supabase/functions/ruc-importar), archivos ruc0..ruc9.

create table if not exists public.ruc_padron (
  ruc text primary key,
  dv smallint,
  razon text not null,
  estado text
);
alter table public.ruc_padron enable row level security;  -- sin políticas: solo vía funciones

create table if not exists public.ruc_padron_log (
  archivo int primary key,
  filas int,
  estado text,
  detalle text,
  updated_at timestamptz not null default now()
);
alter table public.ruc_padron_log enable row level security;
create policy auth_read on public.ruc_padron_log for select to authenticated using (true);

-- Carga un bloque de líneas del padrón DNIT ("RUC|RAZON|DV|RUC_ANT|ESTADO|"). Solo service_role.
create or replace function public.ruc_padron_cargar(p_txt text)
returns int
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
as $$
declare n int;
begin
  insert into ruc_padron (ruc, dv, razon, estado)
  select distinct on (ruc) ruc, dv, razon, estado from (
    select upper(trim(split_part(l,'|',1))) ruc,
           case when trim(split_part(l,'|',3)) ~ '^[0-9]+$' then trim(split_part(l,'|',3))::smallint end dv,
           trim(split_part(l,'|',2)) razon,
           nullif(trim(split_part(l,'|',5)),'') estado
      from string_to_table(p_txt, E'\n') l
     where l like '%|%|%'
  ) x where ruc ~ '^[0-9A-Z]+$' and razon <> ''
  on conflict (ruc) do update set dv = excluded.dv, razon = excluded.razon, estado = excluded.estado
    where (ruc_padron.dv, ruc_padron.razon, ruc_padron.estado) is distinct from (excluded.dv, excluded.razon, excluded.estado);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.ruc_padron_cargar(text) from public, anon, authenticated;
grant execute on function public.ruc_padron_cargar(text) to service_role;

-- Búsqueda pública de RUC (datos públicos de la DNIT). Acepta "4.567.890-1", "4567890" o CI.
create or replace function public.pedidos_ruc(p text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('ruc', r.ruc, 'dv', r.dv, 'razon', r.razon, 'estado', r.estado)
    from ruc_padron r
   where r.ruc = upper(split_part(regexp_replace(coalesce(p,''), '[^0-9A-Za-z-]', '', 'g'), '-', 1))
   limit 1;
$$;
grant execute on function public.pedidos_ruc(text) to anon, authenticated;
