-- Aplicado en Supabase. Cobertura de delivery por distancia (línea recta desde el local).
-- zonas_delivery: [{"km":2,"precio":10000}, ...] ordenadas por km; más allá de la última = fuera de cobertura.
-- Sin ubicación del local o sin zonas, se usa costo_delivery fijo (como antes).

alter table public.pedidos_config add column if not exists local_lat double precision;
alter table public.pedidos_config add column if not exists local_lng double precision;
alter table public.pedidos_config add column if not exists zonas_delivery jsonb not null
  default '[{"km":2,"precio":10000},{"km":4,"precio":15000},{"km":6,"precio":20000},{"km":8,"precio":25000}]'::jsonb;
alter table public.pedidos_online add column if not exists delivery_km numeric;

-- km desde el local a un link "https://maps.google.com/?q=LAT,LNG" (null si no se puede calcular)
create or replace function public.pedidos_km(p_ubicacion text)
returns numeric
language plpgsql stable security definer set search_path = public
as $$
declare c pedidos_config; m text[]; la double precision; lo double precision;
begin
  select * into c from pedidos_config where id = 1;
  if c.local_lat is null or c.local_lng is null then return null; end if;
  m := regexp_match(coalesce(p_ubicacion,''), '(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)');
  if m is null then return null; end if;
  la := m[1]::double precision; lo := m[2]::double precision;
  return round((2 * 6371 * asin(sqrt(
      power(sin(radians(la - c.local_lat) / 2), 2) +
      cos(radians(c.local_lat)) * cos(radians(la)) * power(sin(radians(lo - c.local_lng) / 2), 2))))::numeric, 2);
end $$;
revoke all on function public.pedidos_km(text) from public, anon;

-- pedidos_catalogo: config suma local_lat, local_lng y zonas_delivery
-- pedidos_crear: con ubicación y zonas, el delivery se cobra por zona; fuera de la última zona se rechaza;
--   guarda delivery_km. (Parche aplicado sobre la versión vigente; ver bloque DO en la migración.)
