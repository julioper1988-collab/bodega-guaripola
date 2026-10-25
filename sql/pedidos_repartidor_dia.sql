-- Aplicado en Supabase. "Mis entregas": link personal fijo de cada repartidor (entrega.html?r=<token>).
-- El token vive en pedidos_config.repartidores[].token; cada pedido guarda a qué repartidor se asignó.
-- La noche va de 06:00 a 06:00 (hora de Paraguay), así lo de después de medianoche cuenta en la misma noche.

alter table public.pedidos_online add column if not exists repartidor_tk uuid;
create index if not exists pedidos_online_repartidor_tk_idx on public.pedidos_online(repartidor_tk) where repartidor_tk is not null;

create or replace function public.pedidos_noche(t timestamptz)
returns date language sql immutable as $$ select ((t at time zone 'America/Asuncion') - interval '6 hours')::date $$;

create or replace function public.pedidos_repartidor_dia(p_rtk uuid, p_fecha date default null)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with rep as (
    select r->>'nombre' nombre from pedidos_config c, jsonb_array_elements(c.repartidores) r
     where c.id = 1 and r->>'token' = p_rtk::text limit 1),
  f as (select coalesce(p_fecha, pedidos_noche(now())) d),
  ps as (
    select o.* from pedidos_online o, f
     where o.repartidor_tk = p_rtk and o.estado <> 'cancelado' and pedidos_noche(o.created_at) = f.d)
  select case when (select nombre from rep) is null then null else jsonb_build_object(
    'nombre', (select nombre from rep), 'fecha', (select d from f),
    'entregados', (select count(*) from ps where estado = 'entregado'),
    'en_camino', (select count(*) from ps where estado = 'en_camino'),
    'asignados', (select count(*) from ps where estado not in ('entregado','en_camino')),
    'efectivo', (select coalesce(sum(total),0) from ps where estado = 'entregado' and metodo_pago = 'efectivo'),
    'pedidos', (select coalesce(jsonb_agg(jsonb_build_object('numero',numero,'cliente_nombre',cliente_nombre,'direccion',direccion,
                  'delivery_km',delivery_km,'estado',estado,'salio_at',salio_at,'entregado_at',entregado_at,'metodo_pago',metodo_pago,
                  'total',total,'t',case when created_at > now() - interval '24 hours' then driver_token end) order by created_at desc),'[]'::jsonb) from ps)
  ) end;
$$;
revoke all on function public.pedidos_repartidor_dia(uuid, date) from public;
grant execute on function public.pedidos_repartidor_dia(uuid, date) to anon, authenticated;

-- pedidos_repartidor (vista de un pedido) suma 'mis' = token personal del repartidor, para volver a "Mis entregas".
