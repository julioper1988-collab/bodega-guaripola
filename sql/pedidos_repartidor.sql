-- Aplicado en Supabase. Repartidores: la app asigna el pedido y le manda al repartidor un link
-- (entrega.html?t=<driver_token>) para ver los datos y marcar "Salí" / "Entregado".
-- El token sirve solo para ese pedido y vence a las 24 h de creado el pedido.

alter table public.pedidos_config add column if not exists repartidores jsonb not null default '[]'::jsonb; -- [{nombre, tel}]
alter table public.pedidos_online add column if not exists repartidor text;
alter table public.pedidos_online add column if not exists driver_token uuid;
alter table public.pedidos_online add column if not exists salio_at timestamptz;
alter table public.pedidos_online add column if not exists entregado_at timestamptz;
create unique index if not exists pedidos_online_driver_token_idx on public.pedidos_online(driver_token) where driver_token is not null;

create or replace function public.pedidos_repartidor(p_token uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object('numero',numero,'estado',estado,'cliente_nombre',cliente_nombre,'cliente_telefono',cliente_telefono,
    'direccion',direccion,'ubicacion',ubicacion,'delivery_km',delivery_km,'metodo_pago',metodo_pago,'paga_con',paga_con,
    'total',total,'costo_delivery',costo_delivery,'notas',notas,'factura_ruc',factura_ruc,'factura_razon',factura_razon,
    'repartidor',repartidor,'salio_at',salio_at,'entregado_at',entregado_at,'created_at',created_at,
    'items',(select coalesce(jsonb_agg(jsonb_build_object('nombre',i->>'nombre','cantidad',(i->>'cantidad')::int,'origen',i->>'origen',
               'envase',i->>'envase','envases',i->'envases')),'[]'::jsonb) from jsonb_array_elements(items) i))
    from pedidos_online
   where driver_token = p_token and entrega = 'delivery' and created_at > now() - interval '24 hours';
$$;

create or replace function public.pedidos_repartidor_estado(p_token uuid, p_estado text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare r pedidos_online;
begin
  select * into r from pedidos_online
   where driver_token = p_token and entrega = 'delivery' and created_at > now() - interval '24 hours' for update;
  if r.id is null then return jsonb_build_object('ok',false,'error','Link vencido o inválido.'); end if;
  if r.estado = 'cancelado' then return jsonb_build_object('ok',false,'error','Este pedido fue cancelado.'); end if;
  if p_estado = 'en_camino' then
    if r.estado = 'entregado' then return jsonb_build_object('ok',false,'error','Ya figura entregado.'); end if;
    update pedidos_online set estado = 'en_camino', salio_at = coalesce(salio_at, now()), updated_at = now() where id = r.id;
  elsif p_estado = 'entregado' then
    update pedidos_online set estado = 'entregado', salio_at = coalesce(salio_at, now()), entregado_at = coalesce(entregado_at, now()), updated_at = now() where id = r.id;
  else
    return jsonb_build_object('ok',false,'error','Estado inválido.');
  end if;
  return jsonb_build_object('ok',true,'estado',p_estado);
end $$;

revoke all on function public.pedidos_repartidor(uuid) from public;
revoke all on function public.pedidos_repartidor_estado(uuid, text) from public;
grant execute on function public.pedidos_repartidor(uuid) to anon, authenticated;
grant execute on function public.pedidos_repartidor_estado(uuid, text) to anon, authenticated;
