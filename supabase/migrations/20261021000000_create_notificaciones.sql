-- ============================================================
-- Notificaciones internas de la plataforma (Promas ICAVE).
-- Se usan, por ahora, para avisar al supervisor cuando el revisor
-- devuelve una actividad entregada a "Pendiente".
-- Los registros los inserta el servidor con la service role key.
-- ============================================================

create extension if not exists "pgcrypto";

create table if not exists public.notificaciones (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  user_email    text not null,
  type          text not null default 'general',
  title         text not null,
  body          text,
  assignment_id uuid,
  href          text,
  read_at       timestamptz
);

create index if not exists notificaciones_user_email_created_idx
  on public.notificaciones (lower(user_email), created_at desc);

create index if not exists notificaciones_unread_idx
  on public.notificaciones (lower(user_email))
  where read_at is null;

alter table public.notificaciones enable row level security;

-- Cada usuario sólo ve sus propias notificaciones.
drop policy if exists "notificaciones_select_own" on public.notificaciones;
create policy "notificaciones_select_own"
  on public.notificaciones
  for select
  to authenticated
  using (lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- Cada usuario sólo puede marcar como leídas las suyas.
drop policy if exists "notificaciones_update_own" on public.notificaciones;
create policy "notificaciones_update_own"
  on public.notificaciones
  for update
  to authenticated
  using (lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

grant select, update on public.notificaciones to authenticated;
