-- Aplicado en Supabase. Destacados elegidos a mano en Catálogo online (⭐).
-- Si hay productos de bodega marcados, la sección «Destacados» de pedidos.html muestra esos;
-- si no hay ninguno, sigue el criterio automático (más vendidos).
alter table public.bodega_productos add column if not exists destacado_online boolean not null default false;
-- pedidos_catalogo(): se agrega 'destacado', x.destacado_online al JSON de cada producto de bodega
-- (y b.destacado_online al select interno). Parche aplicado con replace() sobre la definición vigente.
