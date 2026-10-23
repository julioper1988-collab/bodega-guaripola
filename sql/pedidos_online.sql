-- Aplicado en Supabase (migración pedidos_online).
-- Pedidos online combinados: Asadito (tabla productos, caja propia) + Bodega (bodega_productos, caja bodega).
-- Los clientes (anon) NO acceden a tablas: solo a las funciones pedidos_catalogo / pedidos_crear / pedidos_estado.

alter table public.bodega_productos add column if not exists vender_online boolean not null default false;
alter table public.productos add column if not exists vender_online boolean not null default false;
-- retornables: producto de envase que se cobra si el cliente no tiene envase para cambiar (categoría ENVASES)
alter table public.bodega_productos add column if not exists envase_id uuid references public.bodega_productos(id) on delete set null;

create table if not exists public.pedidos_config (
  id int primary key default 1 check (id = 1),
  abierto boolean not null default false,
  costo_delivery numeric not null default 0,
  pedido_minimo numeric not null default 0,
  whatsapp text,
  mensaje text,
  metodos_pago jsonb not null default '["efectivo","transferencia","qr","tarjeta"]'::jsonb,
  -- horarios por local: {"asadito":{"1":["17:30","23:30"],...},"bodega":{...}}; 0=domingo, "24:00"=medianoche, día ausente=cerrado
  horarios jsonb not null default '{}'::jsonb,
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
  metodo_pago text not null check (metodo_pago in ('efectivo','transferencia','qr','tarjeta')),
  paga_con numeric,
  notas text,
  items jsonb not null,
  total_asadito numeric not null default 0,
  total_bodega numeric not null default 0,
  costo_delivery numeric not null default 0,
  total numeric not null default 0,
  estado text not null default 'pendiente'
    check (estado in ('pendiente','aceptado','preparando','en_camino','entregado','cancelado')),
  bodega_cargado boolean not null default false,
  factura_ruc text,      -- si el cliente pide factura
  factura_razon text
);
create index if not exists pedidos_online_created_idx on public.pedidos_online(created_at desc);
create index if not exists pedidos_online_estado_idx on public.pedidos_online(estado);

alter table public.pedidos_config enable row level security;
alter table public.pedidos_online enable row level security;
create policy auth_all on public.pedidos_config for all to authenticated using (true) with check (true);
create policy auth_all on public.pedidos_online for all to authenticated using (true) with check (true);

-- ¿Está abierto el local ahora? (hora de Paraguay). Sin horario cargado = abierto. Soporta horarios que pasan la medianoche.
create or replace function public.pedidos_local_abierto(p_local text, p_ts timestamptz default now())
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  h jsonb;
  t timestamp := p_ts at time zone 'America/Asuncion';
  dow int := extract(dow from t);
  ayer int := (extract(dow from t)::int + 6) % 7;
  m int := extract(hour from t) * 60 + extract(minute from t);
  r jsonb; a int; c int;
begin
  select horarios->p_local into h from pedidos_config where id = 1;
  if h is null then return true; end if;  -- local sin horario cargado: siempre abierto
  r := h->(dow::text);
  if r is not null then
    a := split_part(r->>0,':',1)::int*60 + split_part(r->>0,':',2)::int;
    c := split_part(r->>1,':',1)::int*60 + split_part(r->>1,':',2)::int;
    if c <= a then c := c + 1440; end if;
    if m >= a and m < c then return true; end if;
  end if;
  r := h->(ayer::text);
  if r is not null then
    a := split_part(r->>0,':',1)::int*60 + split_part(r->>0,':',2)::int;
    c := split_part(r->>1,':',1)::int*60 + split_part(r->>1,':',2)::int;
    if c <= a then c := c + 1440; end if;
    if c > 1440 and m < c - 1440 then return true; end if;
  end if;
  return false;
end $$;

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
                 'pedido_minimo',pedido_minimo,'whatsapp',whatsapp,'mensaje',mensaje,'metodos_pago',metodos_pago,'horarios',horarios,
                 'abierto_asadito',pedidos_local_abierto('asadito'),'abierto_bodega',pedidos_local_abierto('bodega'),
                 'ahora',to_char(now() at time zone 'America/Asuncion','YYYY-MM-DD"T"HH24:MI:SS'))
               from pedidos_config where id = 1),
    'asadito', coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'nombre',p.nombre,
                 'categoria',p.categoria,'precio',p.precio_venta) order by p.categoria, p.nombre)
               from productos p where p.activo and p.vender_online and p.precio_venta > 0), '[]'::jsonb),
    'bodega', coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'nombre',b.nombre,
                 'categoria',coalesce(c.nombre,'Otros'),'precio',b.precio_venta,'imagen_url',b.imagen_url,
                 'disponible',coalesce(b.stock,0) > 0,
                 'envase',(select jsonb_build_object('id',e.id,'nombre',e.nombre,'precio',e.precio_venta)
                           from bodega_productos e where e.id = b.envase_id and e.activo and e.precio_venta > 0),
                 'packs',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'cantidad',e.cantidad,'precio',e.precio_venta,
                            'disponible',coalesce(b.stock,0) >= e.cantidad) order by e.cantidad), '[]'::jsonb)
                          from bodega_embalajes e where e.producto_id = b.id and e.activo and e.cantidad > 1 and e.precio_venta > 0))
                 order by c.nombre, b.nombre)
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
  v_pack uuid;
  v_uds int;
  v_usado jsonb := '{}'::jsonb;
  v_env_id uuid; v_env_nom text; v_env_precio numeric; v_env text;
  v_f_ruc text := nullif(upper(regexp_replace(coalesce(p->'factura'->>'ruc',''), '[^0-9A-Za-z-]', '', 'g')), '');
  v_f_razon text := nullif(left(trim(coalesce(p->'factura'->>'razon','')), 120), '');
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
  if coalesce(v_pago,'') not in ('efectivo','transferencia','qr','tarjeta') or not (coalesce(cfg.metodos_pago,'[]'::jsonb) ? v_pago) then return jsonb_build_object('ok', false, 'error', 'Elegí método de pago.'); end if;
  -- factura: RUC (con o sin dígito verificador) o CI, y razón social
  if v_f_ruc is not null or v_f_razon is not null then
    if v_f_ruc is null or v_f_ruc !~ '^[0-9A-Z]{3,12}(-[0-9])?$' then return jsonb_build_object('ok', false, 'error', 'Revisá el RUC para la factura (ej: 1234567-8).'); end if;
    if v_f_razon is null or length(v_f_razon) < 2 then return jsonb_build_object('ok', false, 'error', 'Ingresá el nombre o razón social para la factura.'); end if;
  end if;
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

    if v_origen in ('asadito','bodega') and not pedidos_local_abierto(v_origen) then
      return jsonb_build_object('ok', false, 'error', case when v_origen = 'asadito' then 'El asadito' else 'La bodega' end
        || ' está cerrado ahora. Quitá esos productos o pedí más tarde.');
    end if;
    v_pack := null; v_uds := 1;
    begin
      if v_origen = 'asadito' then
        select nombre, precio_venta, (activo and vender_online) into v_nombre, v_precio, v_ok
          from productos where id = (it->>'id')::bigint;
        v_stock := null;
      elsif v_origen = 'bodega' then
        select nombre, precio_venta, (activo and vender_online), coalesce(stock,0) into v_nombre, v_precio, v_ok, v_stock
          from bodega_productos where id = (it->>'id')::uuid;
        if nullif(it->>'pack','') is not null then
          select e.id, e.cantidad, e.precio_venta, v_ok and e.activo into v_pack, v_uds, v_precio, v_ok
            from bodega_embalajes e where e.id = (it->>'pack')::uuid and e.producto_id = (it->>'id')::uuid and e.cantidad > 1;
          if v_pack is null then v_ok := false; end if;
          v_nombre := v_nombre || ' (pack x' || v_uds || ')';
        end if;
      else
        v_ok := false;
      end if;
    exception when others then v_ok := false;
    end;

    if not coalesce(v_ok, false) or coalesce(v_precio,0) <= 0 then
      return jsonb_build_object('ok', false, 'error', 'Un producto ya no está disponible. Actualizá la página.');
    end if;
    if v_stock is not null then
      -- stock en unidades, sumando unidades sueltas y packs del mismo producto
      v_usado := jsonb_set(v_usado, array[it->>'id'], to_jsonb(coalesce((v_usado->>(it->>'id'))::int, 0) + v_cant * v_uds));
      if v_stock < (v_usado->>(it->>'id'))::int then
        return jsonb_build_object('ok', false, 'error', 'Sin stock suficiente de '||v_nombre||' (quedan '||greatest(v_stock,0)||' unidades).');
      end if;
    end if;

    -- retornables: el cliente indica si tiene envase para cambiar o si se le cobra
    v_env_id := null; v_env := null;
    if v_origen = 'bodega' then
      select e.id, e.nombre, e.precio_venta into v_env_id, v_env_nom, v_env_precio
        from bodega_productos b join bodega_productos e on e.id = b.envase_id
       where b.id = (it->>'id')::uuid and e.activo and e.precio_venta > 0;
      if v_env_id is not null then
        v_env := it->>'envase';
        if coalesce(v_env,'') not in ('tengo','cobrar') then
          return jsonb_build_object('ok', false, 'error', 'Indicá si tenés envases para '||v_nombre||'.');
        end if;
      end if;
    end if;

    -- paréntesis: sumar campos al objeto (no agregar elementos al array)
    v_items := v_items || (jsonb_build_object('origen',v_origen,'id',it->>'id','nombre',v_nombre,
                 'precio',v_precio,'cantidad',v_cant,'subtotal',v_precio * v_cant)
               || case when v_pack is not null then jsonb_build_object('pack',v_pack,'pack_uds',v_uds) else '{}'::jsonb end
               || case when v_env_id is not null then jsonb_build_object('envase',v_env,'envases',v_cant * v_uds) else '{}'::jsonb end);
    if v_origen = 'asadito' then v_tot_a := v_tot_a + v_precio * v_cant;
    else v_tot_b := v_tot_b + v_precio * v_cant; end if;
    if v_env_id is not null and v_env = 'cobrar' then
      v_items := v_items || jsonb_build_array(jsonb_build_object('origen','bodega','id',v_env_id,'nombre','♻️ '||v_env_nom,'precio',v_env_precio,
                   'cantidad',v_cant * v_uds,'subtotal',v_env_precio * v_cant * v_uds,'es_envase',true));
      v_tot_b := v_tot_b + v_env_precio * v_cant * v_uds;
    end if;
    v_ok := null; v_precio := null;
  end loop;

  if v_tot_a + v_tot_b < coalesce(cfg.pedido_minimo, 0) then
    return jsonb_build_object('ok', false, 'error', 'El pedido mínimo es Gs. '||replace(to_char(cfg.pedido_minimo,'FM999,999,999'),',','.'));
  end if;
  if v_ent = 'delivery' then v_deliv := coalesce(cfg.costo_delivery, 0); end if;

  insert into pedidos_online (cliente_nombre, cliente_telefono, entrega, direccion, ubicacion, metodo_pago,
      paga_con, notas, items, total_asadito, total_bodega, costo_delivery, total, factura_ruc, factura_razon)
  values (v_nom, v_tel, v_ent, v_dir, nullif(left(trim(coalesce(p->>'ubicacion','')), 300), ''), v_pago,
      case when v_pago = 'efectivo' then nullif(left(regexp_replace(coalesce(p->>'paga_con',''), '[^0-9]', '', 'g'), 12), '')::numeric end,
      nullif(left(trim(coalesce(p->>'notas','')), 500), ''), v_items, v_tot_a, v_tot_b, v_deliv, v_tot_a + v_tot_b + v_deliv, v_f_ruc, v_f_razon)
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
