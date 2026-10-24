-- Aplicado en Supabase. Motor de promociones de Pedidos online.
-- Tipos: delivery_gratis (desde un monto), descuento (% por local/categorías/productos),
--        combo (productos a precio cerrado, puede mezclar asadito y bodega),
--        fidelidad (cada N pedidos, el siguiente con delivery gratis).
-- Vigencia: días (0=domingo … 6=sábado; vacío = todos) y horario (vacío = todo el día), hora de Paraguay.

create table if not exists public.pedidos_promos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo text not null check (tipo in ('delivery_gratis','descuento','combo','fidelidad')),
  activa boolean not null default true,
  dias int[],
  hora_desde text,
  hora_hasta text,
  local text check (local in ('asadito','bodega')),
  monto_minimo numeric not null default 0,
  porcentaje numeric check (porcentaje is null or (porcentaje > 0 and porcentaje <= 90)),
  categorias text[],
  productos text[],
  combo jsonb,          -- [{origen, id, cantidad}]
  precio numeric,       -- precio del combo
  cada_n int check (cada_n is null or cada_n >= 2),
  mensaje text,
  orden int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.pedidos_promos enable row level security;
create policy auth_all on public.pedidos_promos for all to authenticated using (true) with check (true);

alter table public.pedidos_online
  add column if not exists descuento numeric not null default 0,
  add column if not exists descuento_asadito numeric not null default 0,
  add column if not exists descuento_bodega numeric not null default 0,
  add column if not exists promos jsonb;

create or replace function public.pedidos_promo_vigente(pr public.pedidos_promos, p_ts timestamptz default now())
returns boolean language plpgsql stable set search_path = public
as $$
declare
  t timestamp := p_ts at time zone 'America/Asuncion';
  dw int := extract(dow from t);
  m int := extract(hour from t) * 60 + extract(minute from t);
  a int; c int;
begin
  if not pr.activa then return false; end if;
  if pr.hora_desde is null or pr.hora_hasta is null then
    return pr.dias is null or cardinality(pr.dias) = 0 or dw = any(pr.dias);
  end if;
  a := split_part(pr.hora_desde,':',1)::int*60 + split_part(pr.hora_desde,':',2)::int;
  c := split_part(pr.hora_hasta,':',1)::int*60 + split_part(pr.hora_hasta,':',2)::int;
  if c <= a then c := c + 1440; end if;
  -- franja que empieza hoy
  if (pr.dias is null or cardinality(pr.dias) = 0 or dw = any(pr.dias)) and m >= a and m < c then return true; end if;
  -- franja que empezó ayer y pasa la medianoche
  if c > 1440 and m < c - 1440 and (pr.dias is null or cardinality(pr.dias) = 0 or ((dw + 6) % 7) = any(pr.dias)) then return true; end if;
  return false;
end $$;

-- Pedidos online previos (no cancelados) de un teléfono
create or replace function public.pedidos_cliente_info(p_tel text)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'pedidos', (select count(*) from pedidos_online where tel_norm = tel_norm(p_tel) and estado <> 'cancelado'),
    'nuevo', pedidos_es_nuevo(p_tel))
  where length(tel_norm(p_tel)) >= 9;
$$;
grant execute on function public.pedidos_cliente_info(text) to anon, authenticated;

-- Promos vigentes para la página (los combos llevan sus productos, precio normal y si están disponibles)
create or replace function public.pedidos_promos_vigentes()
returns jsonb language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(x order by x->>'orden_n', x->>'nombre'), '[]'::jsonb) from (
    select jsonb_build_object('id',pr.id,'nombre',pr.nombre,'tipo',pr.tipo,'local',pr.local,'monto_minimo',pr.monto_minimo,
             'porcentaje',pr.porcentaje,'categorias',pr.categorias,'productos',pr.productos,'precio',pr.precio,'cada_n',pr.cada_n,
             'mensaje',pr.mensaje,'hora_hasta',pr.hora_hasta,'orden_n',lpad(pr.orden::text,6,'0'),
             'componentes', case when pr.tipo = 'combo' then (
                select jsonb_agg(jsonb_build_object('origen',c->>'origen','id',c->>'id','cantidad',(c->>'cantidad')::int,
                         'nombre',coalesce(ap.nombre,bp.nombre),'precio',coalesce(ap.precio,bp.precio_venta),
                         'disponible', case when c->>'origen' = 'asadito' then coalesce(ap.activo and ap.precio > 0, false)
                                            else coalesce(bp.activo and bp.precio_venta > 0 and bp.envase_id is null
                                                          and coalesce(bp.stock,0) >= (c->>'cantidad')::int, false) end)
                         order by o)
                  from jsonb_array_elements(pr.combo) with ordinality t(c, o)
                  left join asadito_productos() ap on c->>'origen' = 'asadito' and ap.id = c->>'id'
                  left join bodega_productos bp on c->>'origen' = 'bodega' and bp.id::text = c->>'id') end) x
      from pedidos_promos pr
     where pedidos_promo_vigente(pr)
       and (pr.tipo <> 'combo' or (pr.precio > 0 and jsonb_typeof(pr.combo) = 'array' and jsonb_array_length(pr.combo) > 0))) s;
$$;

create or replace function public.pedidos_crear(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg pedidos_config;
  it jsonb;
  v_lista jsonb := '[]'::jsonb;   -- ítems del cliente con los combos expandidos
  v_items jsonb := '[]'::jsonb;
  pr pedidos_promos;
  v_origen text;
  v_cant int;
  v_nombre text;
  v_precio numeric;
  v_cat text;
  v_stock int;
  v_ok boolean;
  v_pack uuid;
  v_uds int;
  v_usado jsonb := '{}'::jsonb;
  v_promo text;
  v_promos jsonb := '[]'::jsonb;
  v_env_id uuid; v_env_nom text; v_env_precio numeric; v_env text;
  v_f_ruc text := nullif(upper(regexp_replace(coalesce(p->'factura'->>'ruc',''), '[^0-9A-Za-z-]', '', 'g')), '');
  v_f_razon text := nullif(left(trim(coalesce(p->'factura'->>'razon','')), 120), '');
  v_tot_a numeric := 0;
  v_tot_b numeric := 0;
  v_desc_a numeric := 0;
  v_desc_b numeric := 0;
  v_deliv numeric := 0;
  v_idx int := 0;
  k text; na numeric; nb numeric; d numeric; da numeric; pct numeric; best numeric; best_nom text; ln jsonb; i int;
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

  if (select count(*) from pedidos_online where cliente_telefono = v_tel and estado = 'pendiente'
        and created_at > now() - interval '15 minutes') >= 3 then
    return jsonb_build_object('ok', false, 'error', 'Ya tenés pedidos pendientes. Esperá la confirmación.');
  end if;

  -- expandir combos en sus productos (cada combo lleva una clave para calcular su descuento)
  for it in select * from jsonb_array_elements(p->'items') loop
    if it->>'origen' = 'combo' then
      begin v_cant := (it->>'cantidad')::int; exception when others then v_cant := 0; end;
      if v_cant is null or v_cant < 1 or v_cant > 20 then return jsonb_build_object('ok', false, 'error', 'Cantidad inválida.'); end if;
      pr := null;
      begin select * into pr from pedidos_promos where id = (it->>'id')::uuid and tipo = 'combo'; exception when others then pr := null; end;
      if pr.id is null or not pedidos_promo_vigente(pr) or coalesce(pr.precio,0) <= 0 then
        return jsonb_build_object('ok', false, 'error', 'Ese combo ya no está disponible. Actualizá la página.');
      end if;
      v_idx := v_idx + 1;
      v_lista := v_lista || coalesce((select jsonb_agg(jsonb_build_object('origen',c->>'origen','id',c->>'id',
                   'cantidad',(c->>'cantidad')::int * v_cant,'combo_key',v_idx::text,'combo_id',pr.id,'combo_nombre',pr.nombre,
                   'combo_precio',pr.precio * v_cant,'combo_cant',v_cant,'envase','tengo'))
                 from jsonb_array_elements(pr.combo) c), '[]'::jsonb);
    else
      v_lista := v_lista || jsonb_build_array(it);
    end if;
  end loop;

  for it in select * from jsonb_array_elements(v_lista) loop
    v_origen := it->>'origen';
    begin
      v_cant := (it->>'cantidad')::int;
    exception when others then v_cant := 0;
    end;
    if v_cant is null or v_cant < 1 or v_cant > (case when it ? 'combo_key' then 999 else 99 end) then
      return jsonb_build_object('ok', false, 'error', 'Cantidad inválida.');
    end if;

    if v_origen in ('asadito','bodega') and not pedidos_local_abierto(v_origen) then
      return jsonb_build_object('ok', false, 'error', case when v_origen = 'asadito' then 'El asadito' else 'La bodega' end
        || ' está cerrado ahora. Quitá esos productos o pedí más tarde.');
    end if;
    v_pack := null; v_uds := 1; v_cat := null;
    begin
      if v_origen = 'asadito' then
        -- en combos alcanza con que el producto esté activo; suelto, además tiene que estar habilitado online
        select p.nombre, p.precio, (p.activo and (it ? 'combo_key' or coalesce(o.vender_online, false))), coalesce(o.categoria,'ASADITO')
          into v_nombre, v_precio, v_ok, v_cat
          from asadito_productos() p left join pedidos_asadito_online o on o.prod_id = p.id
         where p.id = it->>'id';
        v_stock := null;
      elsif v_origen = 'bodega' then
        select b.nombre, b.precio_venta, (b.activo and (it ? 'combo_key' or b.vender_online)), coalesce(b.stock,0), coalesce(c.nombre,'Otros')
          into v_nombre, v_precio, v_ok, v_stock, v_cat
          from bodega_productos b left join bodega_categorias c on c.id = b.categoria_id where b.id = (it->>'id')::uuid;
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
      return jsonb_build_object('ok', false, 'error', case when it ? 'combo_key' then 'Un producto del combo '||(it->>'combo_nombre')||' no está disponible.'
                                                         else 'Un producto ya no está disponible. Actualizá la página.' end);
    end if;
    if v_stock is not null then
      v_usado := jsonb_set(v_usado, array[it->>'id'], to_jsonb(coalesce((v_usado->>(it->>'id'))::int, 0) + v_cant * v_uds));
      if v_stock < (v_usado->>(it->>'id'))::int then
        return jsonb_build_object('ok', false, 'error', 'Sin stock suficiente de '||v_nombre||' (quedan '||greatest(v_stock,0)||' unidades).');
      end if;
    end if;

    -- retornables: el cliente indica si tiene envase para cambiar o si se le cobra (en combos: no se usan retornables)
    v_env_id := null; v_env := null;
    if v_origen = 'bodega' then
      select e.id, e.nombre, e.precio_venta into v_env_id, v_env_nom, v_env_precio
        from bodega_productos b join bodega_productos e on e.id = b.envase_id
       where b.id = (it->>'id')::uuid and e.activo and e.precio_venta > 0;
      if v_env_id is not null then
        if it ? 'combo_key' then
          return jsonb_build_object('ok', false, 'error', 'El combo '||(it->>'combo_nombre')||' tiene un retornable. Avisá al local.');
        end if;
        v_env := it->>'envase';
        if coalesce(v_env,'') not in ('tengo','cobrar') then
          return jsonb_build_object('ok', false, 'error', 'Indicá si tenés envases para '||v_nombre||'.');
        end if;
      end if;
    end if;

    -- paréntesis: sumar campos al objeto (no agregar elementos al array)
    v_items := v_items || (jsonb_build_object('origen',v_origen,'id',it->>'id','nombre',v_nombre,
                 'precio',v_precio,'cantidad',v_cant,'subtotal',v_precio * v_cant,'cat',v_cat)
               || case when v_pack is not null then jsonb_build_object('pack',v_pack,'pack_uds',v_uds) else '{}'::jsonb end
               || case when v_env_id is not null then jsonb_build_object('envase',v_env,'envases',v_cant * v_uds) else '{}'::jsonb end
               || case when it ? 'combo_key' then jsonb_build_object('combo_key',it->>'combo_key','combo',it->>'combo_nombre',
                         'combo_precio',(it->>'combo_precio')::numeric,'combo_cant',(it->>'combo_cant')::int) else '{}'::jsonb end);
    if v_origen = 'asadito' then v_tot_a := v_tot_a + v_precio * v_cant;
    else v_tot_b := v_tot_b + v_precio * v_cant; end if;
    if v_env_id is not null and v_env = 'cobrar' then
      v_items := v_items || jsonb_build_array(jsonb_build_object('origen','bodega','id',v_env_id,'nombre','♻️ '||v_env_nom,'precio',v_env_precio,
                   'cantidad',v_cant * v_uds,'subtotal',v_env_precio * v_cant * v_uds,'es_envase',true));
      v_tot_b := v_tot_b + v_env_precio * v_cant * v_uds;
    end if;
    v_ok := null; v_precio := null;
  end loop;

  -- combos: descuento = precio normal − precio del combo, repartido entre asadito y bodega
  for k in select distinct x->>'combo_key' from jsonb_array_elements(v_items) x where x ? 'combo_key' loop
    select coalesce(sum((x->>'subtotal')::numeric) filter (where x->>'origen' = 'asadito'),0),
           coalesce(sum((x->>'subtotal')::numeric) filter (where x->>'origen' = 'bodega'),0),
           max((x->>'combo_precio')::numeric), max(x->>'combo')
      into na, nb, d, best_nom
      from jsonb_array_elements(v_items) x where x->>'combo_key' = k;
    d := greatest(0, na + nb - d);
    if d > 0 then
      da := round(d * na / nullif(na + nb, 0));
      v_desc_a := v_desc_a + da; v_desc_b := v_desc_b + (d - da);
      v_promos := v_promos || jsonb_build_array(jsonb_build_object('tipo','combo','nombre',best_nom,'monto',d));
    end if;
  end loop;

  -- descuentos %: a cada línea (no combo, no envase) se le aplica la mejor promo vigente
  na := v_tot_a + v_tot_b;   -- total bruto para el monto mínimo
  for i in 0 .. jsonb_array_length(v_items) - 1 loop
    ln := v_items->i;
    continue when ln ? 'combo_key' or coalesce((ln->>'es_envase')::boolean, false);
    best := 0; best_nom := null;
    for pr in select * from pedidos_promos where tipo = 'descuento' and pedidos_promo_vigente(pedidos_promos) loop
      continue when pr.local is not null and pr.local <> ln->>'origen';
      continue when pr.categorias is not null and cardinality(pr.categorias) > 0 and not ((ln->>'cat') = any(pr.categorias));
      continue when pr.productos is not null and cardinality(pr.productos) > 0 and not ((ln->>'id') = any(pr.productos));
      continue when na < coalesce(pr.monto_minimo, 0);
      pct := coalesce(pr.porcentaje, 0);
      if pct > best then best := pct; best_nom := pr.nombre; end if;
    end loop;
    if best > 0 then
      d := round((ln->>'subtotal')::numeric * best / 100);
      if ln->>'origen' = 'asadito' then v_desc_a := v_desc_a + d; else v_desc_b := v_desc_b + d; end if;
      v_items := jsonb_set(v_items, array[i::text], ln || jsonb_build_object('desc_pct',best,'desc',d,'promo',best_nom));
      v_promos := v_promos || jsonb_build_array(jsonb_build_object('tipo','descuento','nombre',best_nom,'monto',d));
    end if;
  end loop;

  if (v_tot_a - v_desc_a) + (v_tot_b - v_desc_b) < coalesce(cfg.pedido_minimo, 0) then
    return jsonb_build_object('ok', false, 'error', 'El pedido mínimo es Gs. '||replace(to_char(cfg.pedido_minimo,'FM999,999,999'),',','.'));
  end if;

  -- delivery: primera compra, fidelidad o delivery gratis desde un monto
  if v_ent = 'delivery' then v_deliv := coalesce(cfg.costo_delivery, 0); end if;
  if v_ent = 'delivery' and v_deliv > 0 and pedidos_es_nuevo(v_tel) then
    v_deliv := 0; v_promo := 'delivery_gratis_primera';
    v_promos := v_promos || jsonb_build_array(jsonb_build_object('tipo','primera_compra','nombre','Delivery gratis 1ª compra','monto',cfg.costo_delivery));
  end if;
  if v_ent = 'delivery' and v_deliv > 0 then
    for pr in select * from pedidos_promos where tipo in ('delivery_gratis','fidelidad') and pedidos_promo_vigente(pedidos_promos) order by orden loop
      if pr.tipo = 'delivery_gratis'
         and (case pr.local when 'asadito' then v_tot_a - v_desc_a when 'bodega' then v_tot_b - v_desc_b
              else (v_tot_a - v_desc_a) + (v_tot_b - v_desc_b) end) >= coalesce(pr.monto_minimo,0) then
        v_promo := 'delivery_gratis';
      elsif pr.tipo = 'fidelidad' and coalesce(pr.cada_n,0) >= 2 then
        i := (select count(*) from pedidos_online where tel_norm = tel_norm(v_tel) and estado <> 'cancelado');
        if i > 0 and i % pr.cada_n = 0 then v_promo := 'fidelidad'; end if;
      end if;
      if v_promo in ('delivery_gratis','fidelidad') then
        v_promos := v_promos || jsonb_build_array(jsonb_build_object('tipo',pr.tipo,'nombre',pr.nombre,'monto',v_deliv));
        v_deliv := 0;
        exit;
      end if;
    end loop;
  end if;

  insert into pedidos_online (cliente_nombre, cliente_telefono, entrega, direccion, ubicacion, metodo_pago,
      paga_con, notas, items, total_asadito, total_bodega, costo_delivery, total, factura_ruc, factura_razon, tel_norm, promo,
      descuento, descuento_asadito, descuento_bodega, promos)
  values (v_nom, v_tel, v_ent, v_dir, nullif(left(trim(coalesce(p->>'ubicacion','')), 300), ''), v_pago,
      case when v_pago = 'efectivo' then nullif(left(regexp_replace(coalesce(p->>'paga_con',''), '[^0-9]', '', 'g'), 12), '')::numeric end,
      nullif(left(trim(coalesce(p->>'notas','')), 500), ''), v_items, v_tot_a - v_desc_a, v_tot_b - v_desc_b, v_deliv,
      (v_tot_a - v_desc_a) + (v_tot_b - v_desc_b) + v_deliv, v_f_ruc, v_f_razon, tel_norm(v_tel), v_promo,
      v_desc_a + v_desc_b, v_desc_a, v_desc_b, nullif(v_promos, '[]'::jsonb))
  returning * into r;

  return jsonb_build_object('ok', true, 'numero', r.numero, 'token', r.token, 'items', r.items,
    'total_asadito', r.total_asadito, 'total_bodega', r.total_bodega, 'costo_delivery', r.costo_delivery, 'total', r.total,
    'promo', r.promo, 'descuento', r.descuento, 'promos', r.promos);
end $$;

-- pedidos_catalogo: se agregó la clave 'promos' (pedidos_promos_vigentes()) antes de 'bodega'
-- (ver sql/pedidos_orden_vendidos.sql para el resto de la función).
