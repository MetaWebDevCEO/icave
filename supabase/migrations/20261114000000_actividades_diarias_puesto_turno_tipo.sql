-- ============================================================
-- Actividades diarias: nuevos campos del formulario del supervisor
--
-- Se reemplazan actividad / descripcion / horas / observaciones
-- por puesto / turno / tipo. La fecha y el adjunto PDF se conservan.
-- ============================================================

alter table public.actividades_diarias
  add column if not exists puesto text,
  add column if not exists turno  text,
  add column if not exists tipo   text;

alter table public.actividades_diarias
  drop column if exists actividad,
  drop column if exists descripcion,
  drop column if exists horas,
  drop column if exists observaciones;
