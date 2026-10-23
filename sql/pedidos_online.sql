-- Aplicado en Supabase (migración pedidos_online).
-- Pedidos online combinados: Asadito (tabla productos, caja propia) + Bodega (bodega_productos, caja bodega).
-- Los clientes (anon) NO acceden a tablas: solo a las funciones pedidos_catalogo / pedidos_crear / pedidos_estado.

alter table public.bodega_productos add column if not exists vender_online boolean not null default false;
alter table public.productos add column if not exists vender_online boolean not null default false;

create table if not exists public.pedidos_config (
  id int primary key default 1 check (id = 1),
  abierto boolean not null default false,
  costo_delivery numeric not null default 0,
  pedido_minimo numeric not null default 0,
  whatsapp text,
  mensaje text,
  updated_at timestamptz not null default now()
);
insert into public.pedidos_config (id) values (1) on conflict do nothing;

create table if not exists public.pedidos_online (
  id uuid primary key default gen_random_uuid(),
  numero bigserial,
  token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cliente_nombre text not null,
  cliente_telefono text not null,
  entrega text not null check (entrega in ('retiro','delivery')),
  direccion text,
  ubicacion text,
  metodo_pago text not null check (metodo_pago in ('efectivo','transferencia')),
  paga_con numeric,
  notas text,
  items jsonb not null,
  total_asadito numeric not null default 0,
  total_bodega numeric not null default 0,
  costo_delivery numeric not null default 0,
  total numeric not null default 0,
  estado text not null default 'pendiente'
    check (estado in ('pendiente','aceptado','preparando','en_camino','entregado','cancelado')),
  bodega_cargado boolean not null default false
);
create index if not exists pedidos_online_created_idx on public.pedidos_online(created_at desc);
create index if not exists pedidos_online_estado_idx on public.pedidos_online(estado);

alter table public.pedidos_config enable row level security;
alter table public.pedidos_online enable row level security;
create policy auth_all on public.pedidos_config for all to authenticated using (true) with check (true);
create policy auth_all on public.pedidos_online for all to authenticated using (true) with check (true);

-- Catálogo público (sin costos ni stock exacto)
create or replace function public.pedidos_catalogo()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'config', (select jsonb_build_object('abierto',abierto,'costo_delivery',costo_delivery,
                 'pedido_minimo',pedido_minimo,'whatsapp',whatsapp,'mensaje',mensaje)
               from pedidos_config where id = 1),
    'asadito', coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'nombre',p.nombre,
                 'categoria',p.categoria,'precio',p.precio_venta) order by p.categoria, p.nombre)
               from productos p where p.activo and p.vender_online and p.precio_venta > 0), '[]'::jsonb),
    'bodega', coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'nombre',b.nombre,
                 'categoria',coalesce(c.nombre,'Otros'),'precio',b.precio_venta,'imagen_url',b.imagen_url,
                 'disponible',coalesce(b.stock,0) > 0) order by c.nombre, b.nombre)
               from bodega_productos b left join bodega_categorias c on c.id = b.categoria_id
               where b.activo and b.vender_online and b.precio_venta > 0), '[]'::jsonb)
  );
$$;

-- Crear pedido: precios siempre tomados de la base, nunca del cliente.
create or replace function public.pedidos_crear(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg pedidos_config;
  it jsonb;
  v_items jsonb := '[]'::jsonb;
  v_origen text;
  v_cant int;
  v_nombre text;
  v_precio numeric;
  v_stock int;
  v_ok boolean;
  v_tot_a numeric := 0;
  v_tot_b numeric := 0;
  v_deliv numeric := 0;
  v_nom text := left(trim(coalesce(p->>'nombre','')), 80);
  v_tel text := left(regexp_replace(coalesce(p->>'telefono',''), '[^0-9+]', '', 'g'), 20);
  v_ent text := p->>'entrega';
  v_pago text := p->>'metodo_pago';
  v_dir text := nullif(left(trim(coalesce(p->>'direccion','')), 300), '');
  r pedidos_online;
begin
  select * into cfg from pedidos_config where id = 1;
  if not coalesce(cfg.abierto, false) then
    return jsonb_build_object('ok', false, 'error', 'El local no está recibiendo pedidos ahora.');
  end if;
  if length(v_nom) < 2 then return jsonb_build_object('ok', false, 'error', 'Ingresá tu nombre.'); end if;
  if length(v_tel) < 6 then return jsonb_build_object('ok', false, 'error', 'Ingresá un teléfono válido.'); end if;
  if coalesce(v_ent,'') not in ('retiro','delivery') then return jsonb_build_object('ok', false, 'error', 'Elegí retiro o delivery.'); end if;
  if v_ent = 'delivery' and v_dir is null then return jsonb_build_object('ok', false, 'error', 'Ingresá la dirección.'); end if;
  if coalesce(v_pago,'') not in ('efectivo','transferencia') then return jsonb_build_object('ok', false, 'error', 'Elegí método de pago.'); end if;
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 or jsonb_array_length(p->'items') > 50 then
    return jsonb_build_object('ok', false, 'error', 'El carrito está vacío.');
  end if;

  -- anti-spam: máximo 3 pedidos pendientes por teléfono en 15 minutos
  if (select count(*) from pedidos_online where cliente_telefono = v_tel and estado = 'pendiente'
        and created_at > now() - interval '15 minutes') >= 3 then
    return jsonb_build_object('ok', false, 'error', 'Ya tenés pedidos pendientes. Esperá la confirmación.');
  end if;

  for it in select * from jsonb_array_elements(p->'items') loop
    v_origen := it->>'origen';
    begin
      v_cant := (it->>'cantidad')::int;
    exception when others then v_cant := 0;
    end;
    if v_cant is null or v_cant < 1 or v_cant > 99 then
      return jsonb_build_object('ok', false, 'error', 'Cantidad inválida.');
    end if;

    begin
      if v_origen = 'asadito' then
        select nombre, precio_venta, (activo and vender_online) into v_nombre, v_precio, v_ok
          from productos where id = (it->>'id')::bigint;
        v_stock := null;
      elsif v_origen = 'bodega' then
        select nombre, precio_venta, (activo and vender_online), coalesce(stock,0) into v_nombre, v_precio, v_ok, v_stock
          from bodega_productos where id = (it->>'id')::uuid;
      else
        v_ok := false;
      end if;
    exception when others then v_ok := false;
    end;

    if not coalesce(v_ok, false) or coalesce(v_precio,0) <= 0 then
      return jsonb_build_object('ok', false, 'error', 'Un producto ya no está disponible. Actualizá la página.');
    end if;
    if v_stock is not null and v_stock < v_cant then
      return jsonb_build_object('ok', false, 'error', 'Sin stock suficiente de '||v_nombre||' (quedan '||greatest(v_stock,0)||').');
    end if;

    v_items := v_items || jsonb_build_object('origen',v_origen,'id',it->>'id','nombre',v_nombre,
                 'precio',v_precio,'cantidad',v_cant,'subtotal',v_precio * v_cant);
    if v_origen = 'asadito' then v_tot_a := v_tot_a + v_precio * v_cant;
    else v_tot_b := v_tot_b + v_precio * v_cant; end if;
    v_ok := null; v_precio := null;
  end loop;

  if v_tot_a + v_tot_b < coalesce(cfg.pedido_minimo, 0) then
    return jsonb_build_object('ok', false, 'error', 'El pedido mínimo es Gs. '||to_char(cfg.pedido_minimo,'FM999G999G999'));
  end if;
  if v_ent = 'delivery' then v_deliv := coalesce(cfg.costo_delivery, 0); end if;

  insert into pedidos_online (cliente_nombre, cliente_telefono, entrega, direccion, ubicacion, metodo_pago,
      paga_con, notas, items, total_asadito, total_bodega, costo_delivery, total)
  values (v_nom, v_tel, v_ent, v_dir, nullif(left(trim(coalesce(p->>'ubicacion','')), 300), ''), v_pago,
      case when v_pago = 'efectivo' then nullif(left(regexp_replace(coalesce(p->>'paga_con',''), '[^0-9]', '', 'g'), 12), '')::numeric end,
      nullif(left(trim(coalesce(p->>'notas','')), 500), ''), v_items, v_tot_a, v_tot_b, v_deliv, v_tot_a + v_tot_b + v_deliv)
  returning * into r;

  return jsonb_build_object('ok', true, 'numero', r.numero, 'token', r.token, 'items', r.items,
    'total_asadito', r.total_asadito, 'total_bodega', r.total_bodega, 'costo_delivery', r.costo_delivery, 'total', r.total);
end $$;

-- Seguimiento del pedido por token (solo estado, sin datos personales)
create or replace function public.pedidos_estado(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('numero',numero,'estado',estado,'total',total,'entrega',entrega,'created_at',created_at)
    from pedidos_online where token = p_token;
$$;

revoke all on function public.pedidos_catalogo() from public;
revoke all on function public.pedidos_crear(jsonb) from public;
revoke all on function public.pedidos_estado(uuid) from public;
grant execute on function public.pedidos_catalogo() to anon, authenticated;
grant execute on function public.pedidos_crear(jsonb) to anon, authenticated;
grant execute on function public.pedidos_estado(uuid) to anon, authenticated;
