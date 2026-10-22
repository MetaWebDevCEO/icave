-- ============================================================
-- Chat Directo (Promas ICAVE).
-- Conversaciones 1:1 entre revisores y supervisores.
--
-- Reglas de negocio (validadas en el servidor):
--   * Revisor  <-> Supervisor : permitido.
--   * Revisor  <-> Revisor    : permitido.
--   * Supervisor <-> Supervisor : PROHIBIDO.
--   * Nadie puede leer conversaciones de las que no es participante.
-- ============================================================

create extension if not exists "pgcrypto";

create table if not exists public.conversations (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  created_by           uuid not null,
  last_message_at      timestamptz not null default now(),
  last_message_preview text
);

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null,
  email           text,
  display_name    text,
  role            text,
  joined_at       timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null,
  sender_email    text,
  body            text not null,
  created_at      timestamptz not null default now()
);

create index if not exists conversations_last_message_idx
  on public.conversations (last_message_at desc);

create index if not exists conversation_participants_user_idx
  on public.conversation_participants (user_id);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);

-- Helper: ¿el usuario participa en la conversación?
-- SECURITY DEFINER para evitar recursión en las políticas RLS.
create or replace function public.is_conversation_participant(conv_id uuid, uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_participants p
    where p.conversation_id = conv_id
      and p.user_id = uid
  );
$$;

-- Helper: ¿el usuario creó la conversación?
create or replace function public.is_conversation_creator(conv_id uuid, uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.conversations c
    where c.id = conv_id
      and c.created_by = uid
  );
$$;

alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;

-- ---------------- conversations ----------------
drop policy if exists "conversations_select_participant" on public.conversations;
create policy "conversations_select_participant"
  on public.conversations
  for select
  to authenticated
  using (public.is_conversation_participant(id, auth.uid()));

drop policy if exists "conversations_insert_own" on public.conversations;
create policy "conversations_insert_own"
  on public.conversations
  for insert
  to authenticated
  with check (created_by = auth.uid());

drop policy if exists "conversations_update_participant" on public.conversations;
create policy "conversations_update_participant"
  on public.conversations
  for update
  to authenticated
  using (public.is_conversation_participant(id, auth.uid()))
  with check (public.is_conversation_participant(id, auth.uid()));

-- ---------------- conversation_participants ----------------
drop policy if exists "participants_select_same_conversation" on public.conversation_participants;
create policy "participants_select_same_conversation"
  on public.conversation_participants
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_conversation_participant(conversation_id, auth.uid())
  );

drop policy if exists "participants_insert_self_or_creator" on public.conversation_participants;
create policy "participants_insert_self_or_creator"
  on public.conversation_participants
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    or public.is_conversation_creator(conversation_id, auth.uid())
  );

-- ---------------- messages ----------------
drop policy if exists "messages_select_participant" on public.messages;
create policy "messages_select_participant"
  on public.messages
  for select
  to authenticated
  using (public.is_conversation_participant(conversation_id, auth.uid()));

drop policy if exists "messages_insert_participant" on public.messages;
create policy "messages_insert_participant"
  on public.messages
  for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_conversation_participant(conversation_id, auth.uid())
  );

grant select, insert, update on public.conversations to authenticated;
grant select, insert on public.conversation_participants to authenticated;
grant select, insert on public.messages to authenticated;

-- ---------------- Realtime ----------------
alter table public.messages replica identity full;
alter table public.conversations replica identity full;
alter table public.conversation_participants replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.messages;
  exception when duplicate_object then null;
             when undefined_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.conversations;
  exception when duplicate_object then null;
             when undefined_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.conversation_participants;
  exception when duplicate_object then null;
             when undefined_object then null;
  end;
end;
$$;
