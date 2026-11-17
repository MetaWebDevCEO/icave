-- Bucket privado para los PDF de actividades diarias.
-- La fila de actividades_diarias se crea primero y su UUID forma parte
-- de la ruta: {user_id}/{actividad_id}/documento.pdf.

alter table public.actividades_diarias
  add column if not exists file_bucket text not null default 'asignaciones';

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

drop policy if exists "actdiarias_select_owner_or_reviewer" on storage.objects;
create policy "actdiarias_select_owner_or_reviewer"
  on storage.objects
  for select
  to authenticated
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
  for insert
  to authenticated
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
  for update
  to authenticated
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
  for delete
  to authenticated
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
