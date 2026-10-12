-- Añade la columna submission_files (jsonb) a la tabla asignaciones
-- para soportar múltiples archivos de evidencia por entrega.
-- Se usa jsonb para almacenar un array de objetos { path, name, mime }.

ALTER TABLE public.asignaciones
  ADD COLUMN IF NOT EXISTS submission_files jsonb;

-- Comentario para referencia
COMMENT ON COLUMN public.asignaciones.submission_files IS
  'Array JSONB de archivos de evidencia subidos por el supervisor. Cada elemento: { path, name, mime }';
