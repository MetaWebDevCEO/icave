-- Configuracion completa de actividades diarias y su bucket privado.
-- La ID UUID del registro tambien identifica la carpeta del PDF:
-- {user_id}/{actividad_id}/documento.pdf

create extension if not exists "pgcrypto";

create table if not exists public.actividades_diarias (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text,
  fecha date not null,
  id_puesto smallint references public.puesto(id_puesto),
  id_turno smallint references public.turno(id_turno),
  id_tipo smallint references public.tipo(id_tipo),
  id_area smallint references public.area(id_area),
  id_tipo_actividad smallint references public.tipo_actividad(id_tipo_actividad),
  id_actividad integer references public.actividad(id_actividad),
  file_path text,
  file_bucket text not null default 'actdiarias',
  file_name text,
  file_mime text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Completa columnas faltantes si la tabla ya existia.
alter table public.actividades_diarias
  add column if not exists id_puesto smallint references public.puesto(id_puesto),
  add column if not exists id_turno smallint references public.turno(id_turno),
  add column if not exists id_tipo smallint references public.tipo(id_tipo),
  add column if not exists id_area smallint references public.area(id_area),
  add column if not exists id_tipo_actividad smallint references public.tipo_actividad(id_tipo_actividad),
  add column if not exists id_actividad integer references public.actividad(id_actividad),
  add column if not exists file_path text,
  add column if not exists file_bucket text not null default 'asignaciones',
  add column if not exists file_name text,
  add column if not exists file_mime text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Permite guardar nuevos registros si queda una columna actividad heredada
-- marcada como obligatoria por una version anterior de la tabla.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'actividades_diarias'
      and column_name = 'actividad'
  ) then
    alter table public.actividades_diarias
      alter column actividad drop not null;
  end if;
end;
$$;

create index if not exists actividades_diarias_user_fecha_idx
  on public.actividades_diarias (user_id, fecha desc);

create index if not exists actividades_diarias_catalogos_idx
  on public.actividades_diarias
     (id_puesto, id_turno, id_tipo, id_area, id_tipo_actividad, id_actividad);

create or replace function public.set_actividades_diarias_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_actividades_diarias_updated_at
  on public.actividades_diarias;
create trigger trg_actividades_diarias_updated_at
  before update on public.actividades_diarias
  for each row execute function public.set_actividades_diarias_updated_at();

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

drop policy if exists "actividades_diarias_select_own_or_revisor"
  on public.actividades_diarias;
create policy "actividades_diarias_select_own_or_revisor"
  on public.actividades_diarias
  for select to authenticated
  using (user_id = auth.uid() or public.is_revisor());

drop policy if exists "actividades_diarias_insert_own"
  on public.actividades_diarias;
create policy "actividades_diarias_insert_own"
  on public.actividades_diarias
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "actividades_diarias_update_own"
  on public.actividades_diarias;
create policy "actividades_diarias_update_own"
  on public.actividades_diarias
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "actividades_diarias_delete_own"
  on public.actividades_diarias;
create policy "actividades_diarias_delete_own"
  on public.actividades_diarias
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete
  on public.actividades_diarias to authenticated;

-- Bucket privado: PDFs maximo 10 MB.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'actdiarias',
  'actdiarias',
  false,
  10485760,
  array['application/pdf']
)
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "actdiarias_select_owner_or_reviewer"
  on storage.objects;
create policy "actdiarias_select_owner_or_reviewer"
  on storage.objects
  for select to authenticated
  using (
    bucket_id = 'actdiarias'
    and exists (
      select 1
      from public.actividades_diarias ad
      where ad.id::text = (storage.foldername(name))[2]
        and ad.user_id::text = (storage.foldername(name))[1]
        and (ad.user_id = auth.uid() or public.is_revisor())
    )
  );

drop policy if exists "actdiarias_insert_owner" on storage.objects;
create policy "actdiarias_insert_owner"
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'actdiarias'
    and exists (
      select 1
      from public.actividades_diarias ad
      where ad.id::text = (storage.foldername(name))[2]
        and ad.user_id = auth.uid()
        and ad.user_id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists "actdiarias_update_owner" on storage.objects;
create policy "actdiarias_update_owner"
  on storage.objects
  for update to authenticated
  using (
    bucket_id = 'actdiarias'
    and exists (
      select 1
      from public.actividades_diarias ad
      where ad.id::text = (storage.foldername(name))[2]
        and ad.user_id = auth.uid()
        and ad.user_id::text = (storage.foldername(name))[1]
    )
  )
  with check (
    bucket_id = 'actdiarias'
    and exists (
      select 1
      from public.actividades_diarias ad
      where ad.id::text = (storage.foldername(name))[2]
        and ad.user_id = auth.uid()
        and ad.user_id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists "actdiarias_delete_owner" on storage.objects;
create policy "actdiarias_delete_owner"
  on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'actdiarias'
    and exists (
      select 1
      from public.actividades_diarias ad
      where ad.id::text = (storage.foldername(name))[2]
        and ad.user_id = auth.uid()
        and ad.user_id::text = (storage.foldername(name))[1]
    )
  );
