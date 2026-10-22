-- Corrige el aviso de seguridad "security_definer_view" de Supabase sobre
-- public.v_supervisores_con_email.
--
-- Por defecto, una vista de Postgres se evalúa con los permisos de su
-- propietario (comportamiento SECURITY DEFINER), lo que permite saltarse las
-- políticas RLS de las tablas base y del propio auth.users. Con
-- security_invoker = on, la vista se evalúa con los permisos de quien la
-- consulta, por lo que respeta sus permisos y sus políticas RLS.
--
-- Si la vista lee auth.users, después de este cambio solo podrán leerla los
-- procesos del backend que usan SUPABASE_SERVICE_ROLE_KEY.
do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'v_supervisores_con_email'
      and c.relkind = 'v'
  ) then
    execute 'alter view public.v_supervisores_con_email set (security_invoker = on)';
  end if;
end
$$;
