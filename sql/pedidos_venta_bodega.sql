-- Aplicado en Supabase. Venta de la bodega automática al entregar un pedido online.
-- Al pasar a 'entregado' (desde la app o el repartidor) se registra la venta en la caja abierta, igual que
-- registrar_venta_atomica: productos de bodega (packs, envases cobrados, combos) + línea «Delivery» (SERVICIOS,
-- sin stock) con la forma de pago del pedido y el descuento de promos. Descuenta stock.
-- Nunca se duplica (venta_bodega_id); si ya se cobró a mano (bodega_cargado), no se registra.
-- Si el pedido deja de estar entregado (p. ej. se cancela), la venta se borra y el stock vuelve.

alter table public.pedidos_online add column if not exists venta_bodega_id uuid;
alter table public.pedidos_online add column if not exists venta_bodega_num integer;
alter table public.pedidos_online add column if not exists venta_bodega_aviso text;

create or replace function public.pedidos_venta_bodega(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  r pedidos_online; it jsonb; v_prods jsonb := '[]'::jsonb; v_total numeric := 0; v_tf numeric;
  v_cant int; v_sub numeric; v_uds int; v_del uuid; v_caja uuid; v_num int; v_id uuid; v_met text;
begin
  select * into r from pedidos_online where id = p_id for update;
  if r.id is null or r.estado <> 'entregado' or r.venta_bodega_id is not null then return jsonb_build_object('ok',true,'omitido',true); end if;
  if coalesce(r.bodega_cargado,false) then
    update pedidos_online set venta_bodega_aviso = 'La bodega ya se cobró en caja a mano' where id = r.id;
    return jsonb_build_object('ok',true,'omitido',true);
  end if;

  for it in select * from jsonb_array_elements(coalesce(r.items,'[]'::jsonb)) loop
    continue when it->>'origen' <> 'bodega';
    v_cant := (it->>'cantidad')::int; v_sub := (it->>'subtotal')::numeric;
    continue when coalesce(v_cant,0) <= 0;
    if nullif(it->>'pack','') is not null then
      v_uds := greatest(coalesce((it->>'pack_uds')::int,1),1);
      v_prods := v_prods || jsonb_build_array(jsonb_build_object('producto_id',it->>'id','cantidad',v_cant*v_uds,'precio_unitario',v_sub/v_cant,
        'es_embalaje',true,'uds_por_embalaje',v_uds,'embalaje_id',it->>'pack','cantidad_embalajes',v_cant));
    else
      v_prods := v_prods || jsonb_build_array(jsonb_build_object('producto_id',it->>'id','cantidad',v_cant,'precio_unitario',v_sub/v_cant,
        'es_embalaje',false,'uds_por_embalaje',1));
    end if;
    v_total := v_total + v_sub;
  end loop;

  if coalesce(r.costo_delivery,0) > 0 then
    select b.id into v_del from bodega_productos b join bodega_categorias c on c.id = b.categoria_id
     where lower(b.nombre) = 'delivery' and c.nombre = 'SERVICIOS' order by b.activo desc limit 1;
    if v_del is not null then
      v_prods := v_prods || jsonb_build_array(jsonb_build_object('producto_id',v_del,'cantidad',1,'precio_unitario',r.costo_delivery,
        'es_embalaje',false,'uds_por_embalaje',1,'servicio',true));
      v_total := v_total + r.costo_delivery;
    end if;
  end if;
  if jsonb_array_length(v_prods) = 0 then return jsonb_build_object('ok',true,'omitido',true); end if;

  v_tf := v_total - coalesce(r.descuento_bodega,0);
  v_met := case r.metodo_pago when 'tarjeta' then 'debito' else r.metodo_pago end;
  select id into v_caja from bodega_caja where closed_at is null order by opened_at desc limit 1;
  select coalesce(max(numero_venta),0) + 1 into v_num from bodega_ventas where numero_venta is not null;

  insert into bodega_ventas (fecha, tipo, cliente_nombre, total, descuento, total_final, metodo_pago, notas,
                             monto_efectivo, monto_transferencia, monto_otro, numero_venta, caja_id)
  values ((now() at time zone 'America/Asuncion')::date, 'minorista',
          'Pedido online #'||r.numero||' · '||r.cliente_nombre||case when r.factura_ruc is not null then ' · RUC '||r.factura_ruc else '' end,
          v_total, coalesce(r.descuento_bodega,0), v_tf, v_met, 'Pedido online #'||r.numero||' (registro automático al entregar)',
          case when v_met = 'efectivo' then v_tf else 0 end, case when v_met = 'transferencia' then v_tf else 0 end,
          case when v_met in ('qr','debito','credito') then v_tf else 0 end, v_num, v_caja)
  returning id into v_id;

  insert into bodega_ventas_detalle (venta_id, producto_id, cantidad, precio_unitario, es_embalaje, uds_por_embalaje, embalaje_id, cantidad_embalajes)
  select v_id, (p->>'producto_id')::uuid, (p->>'cantidad')::int, (p->>'precio_unitario')::numeric, (p->>'es_embalaje')::boolean,
         (p->>'uds_por_embalaje')::int, nullif(p->>'embalaje_id','')::uuid, nullif(p->>'cantidad_embalajes','')::int
    from jsonb_array_elements(v_prods) p;

  update bodega_productos bp set stock = bp.stock - (p->>'cantidad')::int
    from jsonb_array_elements(v_prods) p
   where bp.id = (p->>'producto_id')::uuid and not coalesce((p->>'servicio')::boolean, false);

  update pedidos_online set venta_bodega_id = v_id, venta_bodega_num = v_num, bodega_cargado = true,
         venta_bodega_aviso = case when v_caja is null then 'Venta registrada sin caja abierta' end
   where id = r.id;
  return jsonb_build_object('ok',true,'venta_id',v_id,'numero_venta',v_num,'total',v_tf);
end $$;

create or replace function public.pedidos_anular_venta_bodega(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare r pedidos_online; v_del uuid;
begin
  select * into r from pedidos_online where id = p_id for update;
  if r.venta_bodega_id is null then return jsonb_build_object('ok',true,'omitido',true); end if;
  select b.id into v_del from bodega_productos b join bodega_categorias c on c.id = b.categoria_id
   where lower(b.nombre) = 'delivery' and c.nombre = 'SERVICIOS' order by b.activo desc limit 1;
  update bodega_productos bp set stock = bp.stock + d.cantidad
    from bodega_ventas_detalle d where d.venta_id = r.venta_bodega_id and bp.id = d.producto_id and d.producto_id is distinct from v_del;
  delete from bodega_ventas_detalle where venta_id = r.venta_bodega_id;
  delete from bodega_ventas where id = r.venta_bodega_id;
  update pedidos_online set venta_bodega_id = null, venta_bodega_num = null, bodega_cargado = false,
         venta_bodega_aviso = 'Venta #'||r.venta_bodega_num||' anulada (stock devuelto)'
   where id = r.id;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.pedidos_estado_venta_trg()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.estado = 'entregado' and old.estado is distinct from 'entregado' then
    begin perform pedidos_venta_bodega(new.id);
    exception when others then
      update pedidos_online set venta_bodega_aviso = 'No se pudo registrar la venta de bodega: '||sqlerrm where id = new.id;
    end;
  elsif old.estado = 'entregado' and new.estado is distinct from 'entregado' and new.venta_bodega_id is not null then
    begin perform pedidos_anular_venta_bodega(new.id);
    exception when others then
      update pedidos_online set venta_bodega_aviso = 'No se pudo anular la venta de bodega: '||sqlerrm where id = new.id;
    end;
  end if;
  return null;
end $$;

create or replace trigger pedidos_estado_venta after update of estado on public.pedidos_online
  for each row execute function public.pedidos_estado_venta_trg();

revoke all on function public.pedidos_venta_bodega(uuid) from public, anon;
revoke all on function public.pedidos_anular_venta_bodega(uuid) from public, anon;
revoke all on function public.pedidos_estado_venta_trg() from public, anon, authenticated;
grant execute on function public.pedidos_venta_bodega(uuid) to authenticated;  -- reintento manual desde la app
