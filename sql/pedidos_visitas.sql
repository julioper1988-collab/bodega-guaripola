-- Aplicado en Supabase. Contador de visitas de la página de pedidos (anónimo).
-- La página solo puede anotar eventos con pedidos_registrar_visita; nadie de afuera puede leer ni borrar.
-- dev = id aleatorio del navegador (el mismo que ya usa pedidos.html). No guarda nombre, teléfono ni ubicación.

create table if not exists public.pedidos_visitas (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  dev text not null,
  evento text not null check (evento in ('visita','carrito','pedido')),
  src text not null default 'directo',
  nuevo boolean not null default false,
  movil boolean
);
create index if not exists pedidos_visitas_created_idx on public.pedidos_visitas (created_at);
create index if not exists pedidos_visitas_dev_idx on public.pedidos_visitas (dev, evento, created_at);
alter table public.pedidos_visitas enable row level security;
revoke all on public.pedidos_visitas from anon;
drop policy if exists pedidos_visitas_leer on public.pedidos_visitas;
create policy pedidos_visitas_leer on public.pedidos_visitas for select to authenticated using (true);

-- Anota un evento. Una visita cuenta 1 vez cada 30 min por navegador; carrito/pedido, 1 vez cada 30 min también.
create or replace function public.pedidos_registrar_visita(p_evento text, p_dev text, p_src text default null, p_movil boolean default null)
returns void language plpgsql security definer set search_path = public
as $$
declare v_src text := lower(coalesce(nullif(p_src,''),'directo'));
begin
  if p_evento not in ('visita','carrito','pedido') or p_dev is null or length(p_dev) < 8 or length(p_dev) > 64 then return; end if;
  if v_src !~ '^[a-z0-9_-]{1,20}$' then v_src := 'otro'; end if;
  if exists (select 1 from pedidos_visitas where dev = p_dev and evento = p_evento and created_at > now() - interval '30 minutes') then return; end if;
  insert into pedidos_visitas (dev, evento, src, nuevo, movil)
  values (p_dev, p_evento, v_src,
          p_evento = 'visita' and not exists (select 1 from pedidos_visitas where dev = p_dev and evento = 'visita'),
          p_movil);
end $$;

-- Resumen para la app (solo usuarios con sesión)
create or replace function public.pedidos_visitas_resumen(p_desde date, p_hasta date)
returns jsonb language sql stable security definer set search_path = public
as $$
  with v as (
    select *, (created_at at time zone 'America/Asuncion') as t from pedidos_visitas
     where (created_at at time zone 'America/Asuncion')::date between p_desde and p_hasta
  )
  select jsonb_build_object(
    'visitas', (select count(*) from v where evento='visita'),
    'personas', (select count(distinct dev) from v where evento='visita'),
    'nuevos', (select count(*) from v where evento='visita' and nuevo),
    'carrito', (select count(distinct dev) from v where evento='carrito'),
    'pedido', (select count(distinct dev) from v where evento='pedido'),
    'movil', (select count(*) from v where evento='visita' and movil),
    'por_dia', coalesce((select jsonb_agg(x order by x->>'d') from (select jsonb_build_object('d',t::date,'visitas',count(*) filter (where evento='visita'),'personas',count(distinct dev) filter (where evento='visita'),'pedidos',count(distinct dev) filter (where evento='pedido')) x from v group by t::date) s),'[]'::jsonb),
    'por_src', coalesce((select jsonb_agg(x order by (x->>'visitas')::int desc) from (select jsonb_build_object('src',src,'visitas',count(*) filter (where evento='visita'),'pedidos',count(distinct dev) filter (where evento='pedido')) x from v group by src) s),'[]'::jsonb),
    'por_hora', coalesce((select jsonb_agg(x order by (x->>'h')::int) from (select jsonb_build_object('h',extract(hour from t)::int,'visitas',count(*)) x from v where evento='visita' group by extract(hour from t)) s),'[]'::jsonb)
  );
$$;

revoke all on function public.pedidos_registrar_visita(text,text,text,boolean) from public;
grant execute on function public.pedidos_registrar_visita(text,text,text,boolean) to anon, authenticated;
revoke all on function public.pedidos_visitas_resumen(date,date) from public, anon;
grant execute on function public.pedidos_visitas_resumen(date,date) to authenticated;
