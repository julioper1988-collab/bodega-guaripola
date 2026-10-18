-- Aplicado en Supabase (migración ajustar_stock_atomico).
-- Ajuste de stock atómico: bloquea la fila, calcula y registra en bodega_ajustes_stock.
create or replace function public.ajustar_stock(
  p_producto_id uuid,
  p_tipo text,
  p_cantidad int,
  p_delta int,
  p_set int default null,
  p_motivo text default null,
  p_ref_id uuid default null,
  p_ref_tipo text default null,
  p_precio_costo numeric default null,
  p_min_cero boolean default false
) returns int
language plpgsql
as $function$
declare
  v_ant int;
  v_ns int;
begin
  select stock into v_ant from public.bodega_productos where id = p_producto_id for update;
  if not found then return null; end if;
  v_ant := coalesce(v_ant, 0);
  v_ns := coalesce(p_set, v_ant + coalesce(p_delta, 0));
  if p_min_cero then v_ns := greatest(0, v_ns); end if;

  update public.bodega_productos
     set stock = v_ns,
         precio_costo = coalesce(p_precio_costo, precio_costo)
   where id = p_producto_id;

  insert into public.bodega_ajustes_stock
    (producto_id,tipo,cantidad,motivo,stock_anterior,stock_nuevo,referencia_id,referencia_tipo)
  values
    (p_producto_id,p_tipo,p_cantidad,p_motivo,v_ant,v_ns,p_ref_id,p_ref_tipo);

  return v_ns;
end $function$;

-- impactar_stock_compra: se agregó "for update" al leer el stock del producto.
