-- Aplicado en Supabase. Opción «No vender productos sin stock» (Configuración), compartida entre dispositivos.
alter table public.pedidos_config add column if not exists bloquear_sin_stock boolean not null default false;
