-- Aplicado en Supabase. Foto de los asaditos para la página de pedidos.
-- Se guarda en la configuración online (no toca los productos del sistema de asaditos).
-- Archivos en el bucket "productos", carpeta asadito/<prod_id>/ (mismas políticas que bodega).
alter table public.pedidos_asadito_online add column if not exists imagen_url text;
-- pedidos_asadito_admin(): se agrega 'imagen_url', o.imagen_url al JSON.
-- pedidos_catalogo(): se agrega 'imagen_url', x.imagen_url a cada asadito (y o.imagen_url al select interno).
-- Parches aplicados con replace() sobre las definiciones vigentes.
