-- Aplicado en Supabase. Promo: delivery gratis en la primera compra online.
-- El cliente se reconoce por el teléfono normalizado; cuenta como "ya compró" cualquier pedido online no cancelado.
alter table public.pedidos_config add column if not exists promo_delivery_primera boolean not null default false;
alter table public.pedidos_online add column if not exists tel_norm text, add column if not exists promo text;
create index if not exists pedidos_online_tel_norm_idx on public.pedidos_online(tel_norm);

-- 0981123456 / 981123456 / +595981123456 → 0981123456
create or replace function public.tel_norm(t text)
returns text language sql immutable set search_path = public
as $$
  select case
    when d ~ '^595' and length(d) > 9 then '0' || substr(d, 4)
    when d ~ '^9' and length(d) = 9 then '0' || d
    else d end
  from (select regexp_replace(coalesce(t,''), '\D', '', 'g') d) x;
$$;

create or replace function public.pedidos_es_nuevo(p_tel text)
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce((select promo_delivery_primera from pedidos_config where id = 1), false)
     and length(tel_norm(p_tel)) >= 9
     and not exists (select 1 from pedidos_online where tel_norm = tel_norm(p_tel) and estado <> 'cancelado');
$$;
grant execute on function public.pedidos_es_nuevo(text) to anon, authenticated;

-- Cambios aplicados a funciones existentes (por reemplazo de texto):
-- pedidos_crear:
--   if v_ent = 'delivery' and v_deliv > 0 and pedidos_es_nuevo(v_tel) then
--     v_deliv := 0; v_promo := 'delivery_gratis_primera';
--   end if;
--   + guarda tel_norm(v_tel) y v_promo en pedidos_online, y devuelve 'promo'.
-- pedidos_catalogo: config incluye 'promo_delivery_primera'.
