-- ============================================================
-- Actividades diarias (Promas ICAVE)
--
-- Los SUPERVISORES llenan un formulario con:
--   fecha, actividad, descripción, horas, observaciones
-- y pueden adjuntar un PDF al final.
--
-- Los REVISORES ven en modo tabla lo enviado por todos los
-- supervisores y descargan los PDFs.
--
-- Los PDFs se guardan en el bucket existente "asignaciones",
-- carpeta: actividades/{user_id}/...
-- ============================================================

create extension if not exists "pgcrypto";

create table if not exists public.actividades_diarias (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  user_email    text,
  fecha         date not null,
  actividad     text not null,
  descripcion   text,
  horas         numeric(6,2),
  observaciones text,
  file_path     text,
  file_name     text,
  file_mime     text default 'application/pdf',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists actividades_diarias_user_idx
  on public.actividades_diarias (user_id, fecha desc);

create index if not exists actividades_diarias_fecha_idx
  on public.actividades_diarias (fecha desc, created_at desc);

-- updated_at automático
create or replace function public.set_actividades_diarias_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_actividades_diarias_updated_at on public.actividades_diarias;
create trigger trg_actividades_diarias_updated_at
  before update on public.actividades_diarias
  for each row execute function public.set_actividades_diarias_updated_at();

-- Helper: ¿el usuario actual es Revisor? (role_code = '1')
-- SECURITY DEFINER para leer user_roles sin chocar con RLS.
create or replace function public.is_revisor()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles u
    where u.user_id = auth.uid()
      and u.role_code::text = '1'
  );
$$;

alter table public.actividades_diarias enable row level security;

-- El supervisor ve lo suyo; el revisor ve todo.
drop policy if exists "actividades_diarias_select_own_or_revisor" on public.actividades_diarias;
create policy "actividades_diarias_select_own_or_revisor"
  on public.actividades_diarias
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_revisor());

drop policy if exists "actividades_diarias_insert_own" on public.actividades_diarias;
create policy "actividades_diarias_insert_own"
  on public.actividades_diarias
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "actividades_diarias_update_own" on public.actividades_diarias;
create policy "actividades_diarias_update_own"
  on public.actividades_diarias
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "actividades_diarias_delete_own" on public.actividades_diarias;
create policy "actividades_diarias_delete_own"
  on public.actividades_diarias
  for delete
  to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.actividades_diarias to authenticated;

-- ============================================================
-- Storage: bucket existente "asignaciones"
-- Los PDFs van en: actividades/{user_id}/...
-- ============================================================
drop policy if exists "actividades_storage_select" on storage.objects;
create policy "actividades_storage_select"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'asignaciones'
    and (storage.foldername(name))[1] = 'actividades'
    and ((storage.foldername(name))[2] = auth.uid()::text or public.is_revisor())
  );

drop policy if exists "actividades_storage_insert" on storage.objects;
create policy "actividades_storage_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'asignaciones'
    and (storage.foldername(name))[1] = 'actividades'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "actividades_storage_update" on storage.objects;
create policy "actividades_storage_update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'asignaciones'
    and (storage.foldername(name))[1] = 'actividades'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "actividades_storage_delete" on storage.objects;
create policy "actividades_storage_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'asignaciones'
    and (storage.foldername(name))[1] = 'actividades'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
