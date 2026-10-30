-- Aplicado en Supabase. Tiempo estimado y calificación de pedidos online.
alter table public.pedidos_config add column if not exists demora_delivery text not null default '30–45 min';
alter table public.pedidos_config add column if not exists demora_retiro text not null default '15–20 min';
alter table public.pedidos_online add column if not exists eta_at timestamptz;          -- hora estimada (la pone el local al aceptar)
alter table public.pedidos_online add column if not exists calificacion smallint check (calificacion between 1 and 5);
alter table public.pedidos_online add column if not exists calificacion_txt text;
alter table public.pedidos_online add column if not exists calificado_at timestamptz;

create or replace function public.pedidos_estado(p_token uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object('numero',numero,'estado',estado,'total',total,'entrega',entrega,'created_at',created_at,
    'eta_at',eta_at,'calificacion',calificacion)
    from pedidos_online where token = p_token;
$$;

-- El cliente califica una sola vez, solo si el pedido está entregado
create or replace function public.pedidos_calificar(p_token uuid, p_estrellas int, p_texto text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare r pedidos_online;
begin
  if p_estrellas is null or p_estrellas < 1 or p_estrellas > 5 then return jsonb_build_object('ok',false,'error','Elegí de 1 a 5 estrellas.'); end if;
  select * into r from pedidos_online where token = p_token for update;
  if r.id is null then return jsonb_build_object('ok',false,'error','Pedido no encontrado.'); end if;
  if r.estado <> 'entregado' then return jsonb_build_object('ok',false,'error','Podés calificar cuando el pedido esté entregado.'); end if;
  if r.calificacion is not null then return jsonb_build_object('ok',false,'error','Este pedido ya fue calificado. ¡Gracias!'); end if;
  update pedidos_online set calificacion = p_estrellas, calificacion_txt = nullif(left(trim(coalesce(p_texto,'')), 500), ''), calificado_at = now()
   where id = r.id;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.pedidos_calificar(uuid, int, text) from public;
grant execute on function public.pedidos_calificar(uuid, int, text) to anon, authenticated;

alter function public.pedidos_noche(timestamptz) set search_path = public;
alter function public.pedidos_dist(text, text) set search_path = public;
-- pedidos_catalogo: config expone demora_delivery y demora_retiro.
