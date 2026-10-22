-- ============================================================
-- Reporte Mensual de Cierre (Promas ICAVE)
-- 1. Tabla de reportes generados: sirve a la vez como HISTORIAL y como
--    BITÁCORA de descargas (quién generó/descargó, qué, cuándo y con qué folio).
-- 2. Guarda el SNAPSHOT completo del reporte (jsonb) para que:
--      - los meses cerrados queden congelados (no cambian aunque se editen
--        tareas antiguas);
--      - volver a descargar un reporte ya generado devuelva exactamente el
--        mismo documento.
-- 3. Los registros los inserta el servidor con la service role key.
-- ============================================================

create extension if not exists "pgcrypto";

create table if not exists public.reporte_mensual (
  id                  uuid primary key default gen_random_uuid(),
  folio               text not null unique,
  month_key           text not null,                       -- 'YYYY-MM' (UTC)
  parcial             boolean not null default false,      -- true = avance parcial (no oficial)
  supervisor_email    text,                                -- null = reporte global
  supervisor_nombre   text,
  total               integer,
  cumplimiento        numeric(5,2),
  regla_version       text,
  hash_datos          text,
  snapshot            jsonb not null,                       -- MonthlyReport completo
  generado_por        uuid,
  generado_por_email  text,
  generado_por_nombre text,
  generado_en         timestamptz not null default now(),
  constraint reporte_mensual_month_key_formato check (month_key ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

-- Un solo snapshot OFICIAL GLOBAL por mes: al generarse por primera vez queda
-- congelado; las siguientes descargas reutilizan ese registro.
create unique index if not exists reporte_mensual_oficial_global_uidx
  on public.reporte_mensual (month_key)
  where (parcial = false and supervisor_email is null);

create index if not exists reporte_mensual_month_idx
  on public.reporte_mensual (month_key, generado_en desc);

create index if not exists reporte_mensual_generado_en_idx
  on public.reporte_mensual (generado_en desc);

alter table public.reporte_mensual enable row level security;

-- Lectura: sólo usuarios con rol Revisor (role_code = '1') y sólo reportes
-- OFICIALES globales. Los parciales y los filtrados por supervisor se
-- consultan siempre desde el servidor con service role.
drop policy if exists "reporte_mensual_select_revisor" on public.reporte_mensual;
create policy "reporte_mensual_select_revisor"
  on public.reporte_mensual
  for select
  to authenticated
  using (
    parcial = false
    and supervisor_email is null
    and exists (
      select 1
      from public.user_roles u
      where u.user_id = auth.uid()
        and u.role_code::text = '1'
    )
  );

-- FOLIO CONSECUTIVO por (mes, tipo). Se calcula en el servidor y se inserta;
-- el unique de `folio` protege contra colisiones.
create or replace function public.reporte_next_folio(p_month text, p_parcial boolean)
returns text
language plpgsql
stable
as $$
declare
  v_n integer;
begin
  select count(*) + 1
    into v_n
    from public.reporte_mensual
   where month_key = p_month
     and parcial = p_parcial;

  return 'REP-' || p_month || case when p_parcial then '-P' else '' end || '-' || lpad(v_n::text, 4, '0');
end;
$$;

comment on table public.reporte_mensual is
  'Historial + bitácora de descargas del Reporte Mensual de Cierre. Guarda el snapshot jsonb del reporte generado (datos congelados). Una fila por descarga; el snapshot oficial global del mes es único (índice parcial).';
comment on column public.reporte_mensual.snapshot is
  'MonthlyReport serializado (lib/reporte/types.ts). Permite re-descargar el PDF idéntico sin recalcular.';
comment on column public.reporte_mensual.parcial is
  'true = avance parcial del mes en curso (marca de agua PRELIMINAR, nunca oficial).';

grant select on public.reporte_mensual to authenticated;
