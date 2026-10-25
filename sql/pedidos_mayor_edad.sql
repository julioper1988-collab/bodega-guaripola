-- Aplicado en Supabase. Mayoría de edad: si el pedido tiene productos de categorías +18 (alcohol, cigarrillos),
-- el cliente debe confirmar que es mayor de 18 (p.mayor_edad = true). El repartidor ve el aviso para pedir la cédula.

alter table public.pedidos_config add column if not exists categorias_18 text[] not null
  default array['BEBIDAS CON ALCOHOL','CERVEZA','CERVEZAS','CIGARRILLOS','DESTILADOS','FUMABLES','LICORES','PAPEL DE CIGARRILLO','VINO'];
alter table public.pedidos_online add column if not exists mayor_18 boolean not null default false;

-- Parches (bloque DO en la migración):
-- pedidos_catalogo: config expone categorias_18.
-- pedidos_crear: rechaza si hay productos +18 sin confirmación; guarda mayor_18.
-- pedidos_repartidor: devuelve mayor_18.
