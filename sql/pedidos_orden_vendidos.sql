-- Aplicado en Supabase. La página de pedidos ordena por más vendidos (últimos 60 días):
-- primero las categorías con más ventas y, dentro de cada una, los productos más vendidos.
-- Esta versión de pedidos_catalogo reemplaza a la de sql/pedidos_online.sql.

create or replace function public.bodega_vendidos(p_dias int default 60)
returns table(producto_id uuid, uds numeric)
language sql stable security definer set search_path = public
as $$
  select d.producto_id, sum(d.cantidad)::numeric
    from bodega_ventas_detalle d join bodega_ventas v on v.id = d.venta_id
   where v.fecha >= current_date - p_dias
   group by d.producto_id;
$$;

-- Asadito: vendido del día = sobrante anterior + producido − sobrante − avería
create or replace function public.asadito_vendidos(p_dias int default 60)
returns table(prod_id text, uds numeric)
language sql stable security definer set search_path = public
as $$
  with dd as (
    select dia.key::date f, it.key prod_id,
           coalesce(nullif(it.value->>'prod','')::numeric,0) prod,
           nullif(it.value->>'sob','')::numeric sob,
           coalesce(nullif(it.value->>'av','')::numeric,0) av
      from (select data from asaditos_v2_app_state order by updated_at desc limit 1) s,
           jsonb_each(coalesce(s.data->'days','{}'::jsonb)) dia,
           jsonb_each(coalesce(dia.value->'items','{}'::jsonb)) it
     where dia.key ~ '^\d{4}-\d{2}-\d{2}$'),
  v as (select prod_id, f, greatest(0, coalesce(lag(sob) over (partition by prod_id order by f),0) + prod - coalesce(sob,0) - av) vend from dd)
  select prod_id, sum(vend) from v where f >= current_date - p_dias group by prod_id;
$$;
revoke all on function public.bodega_vendidos(int) from public, anon;
revoke all on function public.asadito_vendidos(int) from public, anon;

create or replace function public.pedidos_catalogo()
returns jsonb
language sql
stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'config', (select jsonb_build_object('abierto',abierto,'costo_delivery',costo_delivery,
                 'pedido_minimo',pedido_minimo,'whatsapp',whatsapp,'mensaje',mensaje,'metodos_pago',metodos_pago,'horarios',horarios,
                 'abierto_asadito',pedidos_local_abierto('asadito'),'abierto_bodega',pedidos_local_abierto('bodega'),
                 'ahora',to_char(now() at time zone 'America/Asuncion','YYYY-MM-DD"T"HH24:MI:SS'))
               from pedidos_config where id = 1),
    'asadito', coalesce((
      select jsonb_agg(jsonb_build_object('id',x.id,'nombre',x.nombre,'categoria',x.categoria,'precio',x.precio)
                       order by x.cat_tot desc, x.categoria, x.uds desc, x.nombre)
        from (select p.id, p.nombre, p.precio, o.categoria, coalesce(s.uds,0) uds,
                     sum(coalesce(s.uds,0)) over (partition by o.categoria) cat_tot
                from asadito_productos() p
                join pedidos_asadito_online o on o.prod_id = p.id
                left join asadito_vendidos(60) s on s.prod_id = p.id
               where p.activo and o.vender_online and p.precio > 0) x), '[]'::jsonb),
    'bodega', coalesce((
      select jsonb_agg(jsonb_build_object('id',x.id,'nombre',x.nombre,'categoria',x.categoria,'precio',x.precio_venta,
                 'imagen_url',x.imagen_url,'disponible',x.disponible,'envase',x.envase,'packs',x.packs)
                       order by x.cat_tot desc, x.categoria, x.uds desc, x.nombre)
        from (select b.id, b.nombre, coalesce(c.nombre,'Otros') categoria, b.precio_venta, b.imagen_url,
                     coalesce(b.stock,0) > 0 disponible,
                     (select jsonb_build_object('id',e.id,'nombre',e.nombre,'precio',e.precio_venta)
                        from bodega_productos e where e.id = b.envase_id and e.activo and e.precio_venta > 0) envase,
                     (select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'cantidad',e.cantidad,'precio',e.precio_venta,
                               'disponible',coalesce(b.stock,0) >= e.cantidad) order by e.cantidad), '[]'::jsonb)
                        from bodega_embalajes e where e.producto_id = b.id and e.activo and e.cantidad > 1 and e.precio_venta > 0) packs,
                     coalesce(s.uds,0) uds,
                     sum(coalesce(s.uds,0)) over (partition by coalesce(c.nombre,'Otros')) cat_tot
                from bodega_productos b
                left join bodega_categorias c on c.id = b.categoria_id
                left join bodega_vendidos(60) s on s.producto_id = b.id
               where b.activo and b.vender_online and b.precio_venta > 0) x), '[]'::jsonb)
  );
$$;
