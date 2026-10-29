-- Stock del día de asaditos, compartido por la Caja de asaditos y Pedidos online.
-- Noche = pedidos_noche(now()) (el día cambia a las 6:00, igual que los pedidos).
-- disponible = viene (sobrante del último día cerrado) + producción − averiados
--              − vendidos en caja (asaditos_v2_ventas) − pedidos online no cancelados.
-- Siempre controla: lo que sobró (viene) es stock; la producción que se cargue en la noche suma al disponible.
create or replace function public.asadito_stock()
returns table(prod_id text, disponible int)
language sql stable security definer set search_path = public
as $$
  with st as (select account_id, data from asaditos_v2_app_state order by updated_at desc limit 1),
  f as (select pedidos_noche(now()) f),
  hoy as (select coalesce(st.data->'days'->(f.f::text)->'items', '{}'::jsonb) it from st, f),
  prev as (select coalesce(d.value->'items', '{}'::jsonb) it
             from st, f, jsonb_each(coalesce(st.data->'days','{}'::jsonb)) d
            where d.key ~ '^\d{4}-\d{2}-\d{2}$' and d.key::date < f.f and coalesce((d.value->>'closed')::boolean, false)
            order by d.key desc limit 1),
  caja as (select i->>'id' id, sum((i->>'cant')::int) n
             from asaditos_v2_ventas v, st, f, jsonb_array_elements(v.items) i
            where v.account_id = st.account_id and v.fecha = f.f and not v.anulada group by 1),
  online as (select i->>'id' id, sum((i->>'cantidad')::int) n
               from pedidos_online o, f, jsonb_array_elements(o.items) i
              where pedidos_noche(o.created_at) = f.f and o.estado <> 'cancelado' and i->>'origen' = 'asadito' group by 1)
  select p->>'id',
         (
           coalesce(nullif((select it from prev)->(p->>'id')->>'sob','')::numeric, 0)
           + coalesce(nullif((select it from hoy)->(p->>'id')->>'prod','')::numeric, 0)
           - coalesce(nullif((select it from hoy)->(p->>'id')->>'av','')::numeric, 0)
           - coalesce((select n from caja where caja.id = p->>'id'), 0)
           - coalesce((select n from online where online.id = p->>'id'), 0))::int
    from st, jsonb_array_elements(coalesce(st.data->'products','[]'::jsonb)) p
   where coalesce(p->>'id','') <> '';
$$;
revoke all on function public.asadito_stock() from public, anon, authenticated;
grant execute on function public.asadito_stock() to service_role;

-- Catálogo: asadito agotado cuando disponible <= 0 (sin control = disponible).
do $m$ declare d text := pg_get_functiondef('public.pedidos_catalogo()'::regprocedure); begin
  if position('left join asadito_vendidos(60) s on s.prod_id = p.id' in d) = 0 then raise exception 'catalogo: no match'; end if;
  d := replace(d, 'left join asadito_vendidos(60) s on s.prod_id = p.id',
                  'left join asadito_vendidos(60) s on s.prod_id = p.id left join asadito_stock() st on st.prod_id = p.id');
  d := replace(d, 'select p.id, p.nombre, p.precio, o.categoria,', 'select p.id, p.nombre, p.precio, o.categoria, st.disponible disp,');
  d := replace(d, $r$jsonb_build_object('id',x.id,'nombre',x.nombre,'categoria',x.categoria,'precio',x.precio)$r$,
                  $r$jsonb_build_object('id',x.id,'nombre',x.nombre,'categoria',x.categoria,'precio',x.precio,'disponible',coalesce(x.disp,1) > 0)$r$);
  execute d;
end $m$;

-- Combos con asadito: no disponibles si no alcanza el stock.
do $m$ declare d text := pg_get_functiondef('public.pedidos_promos_vigentes()'::regprocedure); begin
  if position('coalesce(ap.activo and ap.precio > 0, false)' in d) = 0 then raise exception 'promos: no match'; end if;
  execute replace(d, 'coalesce(ap.activo and ap.precio > 0, false)',
    $r$coalesce(ap.activo and ap.precio > 0 and coalesce((select s.disponible from asadito_stock() s where s.prod_id = ap.id), 999999) >= (c->>'cantidad')::int, false)$r$);
end $m$;

-- Al crear el pedido: no deja pedir más de lo que queda (usa el control de stock existente).
do $m$ declare d text := pg_get_functiondef('public.pedidos_crear(jsonb)'::regprocedure); begin
  if position('v_stock := null;' in d) = 0 then raise exception 'crear: no match'; end if;
  execute replace(d, 'v_stock := null;', $r$v_stock := (select s.disponible from asadito_stock() s where s.prod_id = it->>'id');$r$);
end $m$;
