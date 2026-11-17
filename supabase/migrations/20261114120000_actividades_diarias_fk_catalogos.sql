-- ============================================================
-- Actividades diarias: conectar con los catálogos existentes
--
-- Reemplaza las columnas de texto puesto / turno / tipo por
-- claves foráneas a los catálogos de public:
--   puesto, turno, tipo, area, actividad
--
-- La relación tipo/área -> actividad se resuelve con
-- public.actividad_asignacion.
-- ============================================================

alter table public.actividades_diarias
  drop column if exists puesto,
  drop column if exists turno,
  drop column if exists tipo;

alter table public.actividades_diarias
  add column if not exists id_puesto          smallint references public.puesto (id_puesto),
  add column if not exists id_turno           smallint references public.turno (id_turno),
  add column if not exists id_tipo            smallint references public.tipo (id_tipo),
  add column if not exists id_area            smallint references public.area (id_area),
  add column if not exists id_tipo_actividad  smallint references public.tipo_actividad (id_tipo_actividad),
  add column if not exists id_actividad       integer  references public.actividad (id_actividad);

create index if not exists actividades_diarias_catalogos_idx
  on public.actividades_diarias
     (id_puesto, id_turno, id_tipo, id_area, id_tipo_actividad, id_actividad);

-- Lectura de los catálogos para usuarios autenticados.
grant select on public.puesto,
                public.turno,
                public.tipo,
                public.area,
                public.tipo_actividad,
                public.actividad,
                public.actividad_asignacion
  to authenticated;

-- Políticas de lectura (idempotentes). Si el catálogo tiene RLS activo,
-- estas políticas permiten leerlo; si no, quedan inertes.
drop policy if exists "catalogo_puesto_select" on public.puesto;
create policy "catalogo_puesto_select" on public.puesto
  for select to authenticated using (true);

drop policy if exists "catalogo_turno_select" on public.turno;
create policy "catalogo_turno_select" on public.turno
  for select to authenticated using (true);

drop policy if exists "catalogo_tipo_select" on public.tipo;
create policy "catalogo_tipo_select" on public.tipo
  for select to authenticated using (true);

drop policy if exists "catalogo_area_select" on public.area;
create policy "catalogo_area_select" on public.area
  for select to authenticated using (true);

drop policy if exists "catalogo_tipo_actividad_select" on public.tipo_actividad;
create policy "catalogo_tipo_actividad_select" on public.tipo_actividad
  for select to authenticated using (true);

drop policy if exists "catalogo_actividad_select" on public.actividad;
create policy "catalogo_actividad_select" on public.actividad
  for select to authenticated using (true);

drop policy if exists "catalogo_actividad_asignacion_select" on public.actividad_asignacion;
create policy "catalogo_actividad_asignacion_select" on public.actividad_asignacion
  for select to authenticated using (true);
