-- Aplicado en Supabase. Fotos propias de los combos (hasta 3), cargadas en Promociones.
-- Archivos en el bucket "productos", carpeta combos/. Si un combo no tiene fotos, la página usa las de sus productos.
alter table public.pedidos_promos add column if not exists imagenes text[];
-- pedidos_promos_vigentes(): se agrega 'imagenes', pr.imagenes al JSON (parche con replace() sobre la definición vigente).
