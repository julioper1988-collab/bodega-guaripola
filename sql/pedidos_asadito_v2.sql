-- Aplicado en Supabase. El asadito de Pedidos online lee los productos del sistema de control de
-- asaditos (asaditos_v2_app_state.data.products: id, name, price, cost, active). Ese JSON no se modifica:
-- qué se vende online y en qué categoría se guarda en pedidos_asadito_online.

create or replace function public.asadito_productos()
returns table(id text, nombre text, precio numeric, activo boolean)
language sql stable security definer set search_path = public
as $$
  select p->>'id', trim(p->>'name'), nullif(p->>'price','')::numeric, coalesce((p->>'active')::boolean, true)
    from (select data from asaditos_v2_app_state order by updated_at desc limit 1) s,
         jsonb_array_elements(coalesce(s.data->'products','[]'::jsonb)) p
   where coalesce(p->>'id','') <> '';
$$;
revoke all on function public.asadito_productos() from public, anon;
grant execute on function public.asadito_productos() to authenticated;

create table if not exists public.pedidos_asadito_online (
  prod_id text primary key,
  vender_online boolean not null default false,
  categoria text not null default 'ASADITO',
  updated_at timestamptz not null default now()
);
alter table public.pedidos_asadito_online enable row level security;
create policy auth_all on public.pedidos_asadito_online for all to authenticated using (true) with check (true);

-- Para el panel (Catálogo online)
create or replace function public.pedidos_asadito_admin()
returns jsonb language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'nombre',p.nombre,'precio',p.precio,'activo',p.activo,
           'vender_online',coalesce(o.vender_online,false),'categoria',coalesce(o.categoria,'ASADITO')) order by p.activo desc, coalesce(o.categoria,'ASADITO'), p.nombre),'[]'::jsonb)
    from asadito_productos() p left join pedidos_asadito_online o on o.prod_id = p.id;
$$;
revoke all on function public.pedidos_asadito_admin() from public, anon;
grant execute on function public.pedidos_asadito_admin() to authenticated;

-- Nombres fijos para productos del sistema de asaditos: se aplican en cada guardado del sistema,
-- así un dispositivo con datos viejos no puede volver a poner el nombre anterior.
-- Para dejar de forzar un nombre, borrar su fila de asadito_nombres.
create table if not exists public.asadito_nombres (
  prod_id text primary key,
  nombre text not null,
  updated_at timestamptz not null default now()
);
alter table public.asadito_nombres enable row level security;
create policy auth_all on public.asadito_nombres for all to authenticated using (true) with check (true);

create or replace function public.asadito_aplicar_nombres()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if jsonb_typeof(new.data->'products') = 'array' and exists (select 1 from asadito_nombres) then
    new.data := jsonb_set(new.data, '{products}', (
      select coalesce(jsonb_agg(case when n.nombre is not null then jsonb_set(p, '{name}', to_jsonb(n.nombre)) else p end order by o), '[]'::jsonb)
        from jsonb_array_elements(new.data->'products') with ordinality t(p, o)
        left join asadito_nombres n on n.prod_id = p->>'id'));
  end if;
  return new;
end $$;
create trigger asadito_aplicar_nombres before insert or update on public.asaditos_v2_app_state
  for each row execute function public.asadito_aplicar_nombres();

insert into asadito_nombres (prod_id, nombre) values
  ('35bb576c-5866-455e-8ae3-6dc0e4c274c4','PARRILLERO S/ PICANTE (OCHSI)'),
  ('532b2679-c093-4837-a240-263f7675396a','PARRILLERO C/ PICANTE (OCHSI)')
on conflict (prod_id) do update set nombre = excluded.nombre, updated_at = now();
