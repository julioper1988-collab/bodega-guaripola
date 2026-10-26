-- Usuarios solo para la Caja de asaditos (caja-asaditos.html).
-- rol 'caja': cobra, ve las ventas del día y anula tickets de la cuenta de caja_de;
-- no puede entrar al sistema de control (load/save) ni ver stock, costos ni días.
alter table public.asaditos_v2_accounts
  add column if not exists rol text not null default 'admin' check (rol in ('admin','caja')),
  add column if not exists caja_de uuid references public.asaditos_v2_accounts(id);
alter table public.asaditos_v2_accounts drop constraint if exists asaditos_v2_accounts_caja_de_check;
alter table public.asaditos_v2_accounts add constraint asaditos_v2_accounts_caja_de_check
  check ((rol = 'caja') = (caja_de is not null));

-- Alta (la contraseña no se guarda en el repo):
-- insert into asaditos_v2_accounts (username, credential_salt, credential_digest, credential_iterations, active, rol, caja_de)
-- select 'caja', 'bcrypt', extensions.crypt('<contraseña>', extensions.gen_salt('bf', 10)), 0, true, 'caja', id
--   from asaditos_v2_accounts where username = 'julio';
-- Cambiar la contraseña:
-- update asaditos_v2_accounts set credential_digest = extensions.crypt('<nueva>', extensions.gen_salt('bf', 10)) where username = 'caja';
