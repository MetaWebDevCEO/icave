create table if not exists public.matriz_supervisor_asignado (
    matriz_fila_id       int4 not null primary key references public.matriz(id) on delete cascade,
    supervisor_user_id   uuid not null references auth.users(id) on delete cascade,
    assigned_at          timestamptz not null default now(),
    assigned_by          uuid not null references auth.users(id) on delete cascade,
    constraint matriz_fila_id_positivo check (matriz_fila_id > 0)
);

create index if not exists idx_matriz_supervisor_asignado_supervisor
    on public.matriz_supervisor_asignado (supervisor_user_id);

alter table public.matriz_supervisor_asignado enable row level security;

drop policy if exists "Matriz supervisor asignado - lectura solo usuarios autenticados"
    on public.matriz_supervisor_asignado;
create policy "Matriz supervisor asignado - lectura solo usuarios autenticados"
    on public.matriz_supervisor_asignado
    for select
    using ( auth.role() = 'authenticated' );

drop policy if exists "Matriz supervisor asignado - escritura revisores/admin"
    on public.matriz_supervisor_asignado;
create policy "Matriz supervisor asignado - escritura revisores/admin"
    on public.matriz_supervisor_asignado
    for all
    with check (
        auth.uid() is not null
    );

comment on table public.matriz_supervisor_asignado is 'Asociacion persistente fila matriz -> Supervisor (FK a public.matriz.id). Modo 2 pasos: 1) elige supervisor aqui (chip Asignar a, sobrevive F5/logout/cambio de mes). 2) Check materializa en tabla asignaciones (nunca modifica esta tabla).';
