-- Aplicado en Supabase. Evitar que un mismo cliente repita la promo de 1ª compra:
-- 1) el teléfono se compara por los últimos 9 dígitos (con o sin +1, +595 o 0 adelante);
-- 2) la página manda un id de dispositivo (localStorage) y no es "nuevo" si ya pidió desde ese celular;
-- 3) si igual se aplica la promo y hay un pedido anterior con el mismo nombre o la misma ubicación (60 m),
--    el pedido guarda una alerta que la app muestra para revisar.

alter table public.pedidos_online add column if not exists dispositivo text;
alter table public.pedidos_online add column if not exists alerta text;
create index if not exists pedidos_online_tel9_idx on public.pedidos_online (right(tel_norm, 9));
create index if not exists pedidos_online_dispositivo_idx on public.pedidos_online (dispositivo) where dispositivo is not null;

create or replace function public.tel9(t text) returns text language sql immutable set search_path = public
as $$ select right(tel_norm(t), 9) $$;

create or replace function public.pedidos_dist(a text, b text) returns numeric language plpgsql immutable
as $$
declare m1 text[] := regexp_match(coalesce(a,''), '(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)');
        m2 text[] := regexp_match(coalesce(b,''), '(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)');
begin
  if m1 is null or m2 is null then return null; end if;
  return (2 * 6371 * asin(sqrt(power(sin(radians(m2[1]::float8 - m1[1]::float8) / 2), 2) +
    cos(radians(m1[1]::float8)) * cos(radians(m2[1]::float8)) * power(sin(radians(m2[2]::float8 - m1[2]::float8) / 2), 2))))::numeric;
end $$;

create or replace function public.pedidos_es_nuevo(p_tel text, p_dev text)
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce((select promo_delivery_primera from pedidos_config where id = 1), false)
     and length(tel_norm(p_tel)) >= 9
     and not exists (select 1 from pedidos_online where right(tel_norm, 9) = tel9(p_tel) and estado <> 'cancelado')
     and not exists (select 1 from pedidos_online where nullif(p_dev,'') is not null and dispositivo = p_dev and estado <> 'cancelado');
$$;
create or replace function public.pedidos_es_nuevo(p_tel text)
returns boolean language sql stable security definer set search_path = public
as $$ select pedidos_es_nuevo(p_tel, null) $$;

create or replace function public.pedidos_cliente_info(p_tel text, p_dev text)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'pedidos', (select count(*) from pedidos_online where right(tel_norm, 9) = tel9(p_tel) and estado <> 'cancelado'),
    'nuevo', pedidos_es_nuevo(p_tel, p_dev))
  where length(tel_norm(p_tel)) >= 9;
$$;
create or replace function public.pedidos_cliente_info(p_tel text)
returns jsonb language sql stable security definer set search_path = public
as $$ select pedidos_cliente_info(p_tel, null) $$;
grant execute on function public.pedidos_cliente_info(text, text) to anon, authenticated;

-- pedidos_crear (parche sobre la versión vigente):
--   lee p.dispositivo; usa pedidos_es_nuevo(tel, dispositivo); la fidelidad cuenta por últimos 9 dígitos;
--   con promo de 1ª compra, busca pedido anterior con mismo nombre o ubicación < 60 m y guarda la alerta;
--   inserta dispositivo y alerta.
