-- Aplicado en Supabase. Los pagos de fiado no se guardaban: la app insertaba cliente_nombre, que no existía,
-- y el error se ignoraba (0 registros). La plata entraba a la caja pero el arqueo no la esperaba → «sobrante».
alter table public.bodega_pagos_fiado add column if not exists cliente_nombre text;
alter table public.bodega_pagos_fiado add column if not exists caja_id uuid references public.bodega_caja(id) on delete set null;
alter table public.bodega_pagos_fiado alter column fecha set default ((now() at time zone 'America/Asuncion')::date);
create index if not exists bodega_pagos_fiado_caja_idx on public.bodega_pagos_fiado(caja_id);
create index if not exists bodega_pagos_fiado_created_idx on public.bodega_pagos_fiado(created_at);
