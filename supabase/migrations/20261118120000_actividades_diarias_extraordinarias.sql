-- Datos adicionales para identificar y revisar actividades extraordinarias.
-- Las columnas nuevas son opcionales para conservar compatibilidad
-- con los registros ordinarios existentes.
alter table public.actividades_diarias
  add column if not exists categoria_actividad text,
  add column if not exists subcategoria_actividad text,
  add column if not exists nombre_actividad text,
  add column if not exists detalle_actividad jsonb not null default '{}'::jsonb;

comment on column public.actividades_diarias.categoria_actividad is
  'Categoría seleccionada al registrar una actividad extraordinaria.';

comment on column public.actividades_diarias.subcategoria_actividad is
  'Subcategoría seleccionada, cuando aplica.';

comment on column public.actividades_diarias.nombre_actividad is
  'Nombre de la actividad elegida, conservado aunque no tenga vínculo de catálogo.';

comment on column public.actividades_diarias.detalle_actividad is
  'Respuestas a los campos específicos de una actividad extraordinaria.';
