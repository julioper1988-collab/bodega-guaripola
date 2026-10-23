-- Aplicado en Supabase. Notificaciones push de pedidos online (llegan con la app cerrada).
-- Las claves VAPID y hook_secret se cargaron directo en la base (no se guardan en el repo).
create extension if not exists pg_net with schema extensions;

-- Sin políticas: solo la Edge Function (service role) la lee.
create table if not exists public.push_config (
  id int primary key default 1 check (id = 1),
  vapid_public text not null,
  vapid_private text not null,
  hook_secret text not null
);
alter table public.push_config enable row level security;

create table if not exists public.push_suscripciones (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  usuario text,
  dispositivo text,
  created_at timestamptz not null default now()
);
alter table public.push_suscripciones enable row level security;
create policy auth_all on public.push_suscripciones for all to authenticated using (true) with check (true);

-- Al entrar un pedido llama a la Edge Function pedido-push (supabase/functions/pedido-push).
create or replace function public.pedidos_push_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare s text;
begin
  select hook_secret into s from push_config where id = 1;
  if s is not null then
    perform net.http_post(
      url := 'https://sdpysvowvwucjfnyosuf.supabase.co/functions/v1/pedido-push',
      body := jsonb_build_object('pedido_id', new.id),
      headers := jsonb_build_object('Content-Type','application/json','x-hook-secret', s),
      timeout_milliseconds := 10000);
  end if;
  return new;
exception when others then
  return new; -- nunca bloquear el pedido por un fallo de aviso
end $$;

create trigger pedidos_push_after_insert after insert on public.pedidos_online
  for each row execute function public.pedidos_push_trigger();
