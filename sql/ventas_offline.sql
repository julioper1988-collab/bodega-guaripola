-- Aplicado en Supabase (migraciones ventas_offline_idempotente / ventas_offline_caja_original).
alter table public.bodega_ventas add column if not exists client_uuid uuid;
create unique index if not exists bodega_ventas_client_uuid_key on public.bodega_ventas(client_uuid) where client_uuid is not null;

-- Venta (y sus fiados) en una sola operación, idempotente por p_client_uuid.
-- Usada siempre desde la app; las ventas hechas sin conexión se reenvían con el mismo uuid.
CREATE OR REPLACE FUNCTION public.registrar_venta_offline(p_client_uuid uuid, p_venta jsonb, p_fiados jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_existe record;
  v_res jsonb;
  v_id uuid;
  v_caja uuid;
  f jsonb;
begin
  if p_client_uuid is null then
    return jsonb_build_object('ok', false, 'error', 'client_uuid requerido');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_client_uuid::text, 0));

  select id, numero_venta into v_existe from public.bodega_ventas where client_uuid = p_client_uuid;
  if found then
    return jsonb_build_object('ok', true, 'venta_id', v_existe.id, 'numero_venta', v_existe.numero_venta, 'duplicada', true);
  end if;

  -- serializar numeración de ventas
  perform pg_advisory_xact_lock(hashtextextended('bodega_ventas_numero', 0));

  v_res := public.registrar_venta_atomica(
    (p_venta->>'p_fecha')::date,
    p_venta->>'p_tipo',
    p_venta->>'p_cliente_nombre',
    coalesce((p_venta->>'p_total')::numeric, 0),
    coalesce((p_venta->>'p_descuento')::numeric, 0),
    coalesce((p_venta->>'p_total_final')::numeric, 0),
    p_venta->>'p_metodo_pago',
    coalesce(p_venta->'p_productos', '[]'::jsonb),
    p_venta->>'p_notas',
    coalesce((p_venta->>'p_monto_efectivo')::numeric, 0),
    coalesce((p_venta->>'p_monto_transferencia')::numeric, 0),
    coalesce((p_venta->>'p_monto_otro')::numeric, 0)
  );
  if not coalesce((v_res->>'ok')::boolean, false) then
    return v_res;
  end if;
  v_id := (v_res->>'venta_id')::uuid;

  -- venta hecha sin conexión: mantener la caja que estaba abierta al vender
  v_caja := nullif(p_venta->>'p_caja_id', '')::uuid;
  if v_caja is not null and not exists (select 1 from public.bodega_caja where id = v_caja) then
    v_caja := null;
  end if;

  update public.bodega_ventas
     set client_uuid = p_client_uuid,
         caja_id = coalesce(v_caja, caja_id)
   where id = v_id;

  for f in select * from jsonb_array_elements(coalesce(p_fiados, '[]'::jsonb))
  loop
    insert into public.bodega_fiados (venta_id, cliente_id, cliente_nombre, monto_total, monto_pagado, saldo, estado, fecha, notas)
    values (
      v_id,
      nullif(f->>'cliente_id','')::uuid,
      f->>'cliente_nombre',
      coalesce((f->>'monto_total')::numeric, 0),
      0,
      coalesce((f->>'monto_total')::numeric, 0),
      'pendiente',
      coalesce((f->>'fecha')::date, (p_venta->>'p_fecha')::date),
      f->>'notas'
    );
  end loop;

  return v_res;
end $function$;
