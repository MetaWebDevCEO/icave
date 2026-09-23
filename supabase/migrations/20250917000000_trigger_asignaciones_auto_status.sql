-- Trigger: auto-cambiar status de asignaciones cuando se detecta entrega de evidencia.
-- Funciona con las 3 vías que la plataforma usa para marcar "entregada":
--   1) submission_path NO VACÍO (columna de la tabla)
--   2) submission_files ARRAY con al menos 1 elemento (si la columna existe)
--   3) la descripción contiene una línea que empieza por "Entrega: entregas/..." (legacy)
--
-- Si el usuario ya fijó manualmente un status de "completada/cumplida/pagada" lo respetamos.
-- Sólo cambia de status automáticamente cuando detecta evidencia Y el status actual estaba abierto.

CREATE OR REPLACE FUNCTION trg_asignaciones_auto_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  tiene_submission_path boolean := false;
  tiene_submission_files boolean := false;
  tiene_entrega_legacy boolean := false;
  evidencia boolean := false;
  status_ lowercase text;
  status_cerrado boolean := false;
  col_existe boolean;
BEGIN
  -- 1) submission_path
  BEGIN
    EXECUTE 'SELECT ($1).submission_path IS NOT NULL AND length(trim(($1).submission_path)) > 0'
      USING NEW INTO tiene_submission_path;
  EXCEPTION WHEN undefined_column THEN
    tiene_submission_path := false;
  END;

  -- 2) submission_files (columna json/jsonb/array)
  BEGIN
    EXECUTE 'SELECT CASE WHEN pg_typeof(($1).submission_files)::text = ''json''::text OR pg_typeof(($1).submission_files)::text = ''jsonb''::text THEN
                     jsonb_array_length(($1).submission_files::jsonb) > 0
                   WHEN ($1).submission_files IS NOT NULL THEN
                     coalesce(array_length(($1).submission_files, 1), 0) > 0
                   ELSE false
                 END'
      USING NEW INTO tiene_submission_files;
  EXCEPTION WHEN undefined_column THEN
    tiene_submission_files := false;
  WHEN others THEN
    BEGIN
      EXECUTE 'SELECT ($1).submission_files IS NOT NULL AND ($1).submission_files::text <> ''[]''::text AND ($1).submission_files::text <> ''null''::text'
        USING NEW INTO tiene_submission_files;
    EXCEPTION WHEN others THEN
      tiene_submission_files := false;
    END;
  END;

  -- 3) description con linea Entrega: entregas/ (legacy)
  BEGIN
    EXECUTE 'SELECT coalesce(($1).description, '''')::text ~* ''(\m|\n)Entrega:\s*entregas/'''
      USING NEW INTO tiene_entrega_legacy;
  EXCEPTION WHEN undefined_column THEN
    tiene_entrega_legacy := false;
  END;

  evidencia := (tiene_submission_path OR tiene_submission_files OR tiene_entrega_legacy);
  IF NOT evidencia THEN
    RETURN NEW;
  END IF;

  -- Si no hay columna status, no hay nada que modificar
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = TG_TABLE_SCHEMA
       AND table_name   = TG_TABLE_NAME
       AND column_name  = 'status'
  ) INTO col_existe;
  IF NOT col_existe THEN
    RETURN NEW;
  END IF;

  BEGIN
    EXECUTE 'SELECT lower(coalesce(trim(($1).status::text), ''''))' USING NEW INTO status_;
  EXCEPTION WHEN undefined_column THEN
    RETURN NEW;
  END;

  status_cerrado := (
    status_ LIKE '%comp%'    OR
    status_ LIKE '%done%'    OR
    status_ LIKE '%hech%'    OR
    status_ LIKE '%final%'   OR
    status_ LIKE '%termin%'  OR
    status_ LIKE '%cerrad%'  OR
    status_ LIKE '%cumpl%'   OR
    status_ LIKE '%pagad%'
  );

  IF status_cerrado THEN
    RETURN NEW;
  END IF;

  -- Sólo cambiamos automáticamente a Completada si hay evidencia y status estaba abierto
  NEW.status := 'Completada';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_asignaciones_auto_status_insert_update ON asignaciones;

CREATE TRIGGER trg_asignaciones_auto_status_insert_update
BEFORE INSERT OR UPDATE ON asignaciones
FOR EACH ROW
EXECUTE FUNCTION trg_asignaciones_auto_status();

-- ============================================================
-- Backfill: PASA UNA SOLA VEZ todas las asignaciones existentes
-- y marca status = 'Completada' donde ya había evidencia.
-- Ejecuta un UPDATE "dummy" (igual valor) para que se dispare el trigger.
-- ============================================================
DO $$
DECLARE
  actualizadas integer;
BEGIN
  WITH c AS (
    SELECT id
      FROM asignaciones
     WHERE lower(coalesce(trim(status::text), '')) NOT LIKE '%comp%'
       AND lower(coalesce(trim(status::text), '')) NOT LIKE '%done%'
       AND lower(coalesce(trim(status::text), '')) NOT LIKE '%hech%'
       AND lower(coalesce(trim(status::text), '')) NOT LIKE '%final%'
       AND lower(coalesce(trim(status::text), '')) NOT LIKE '%termin%'
       AND lower(coalesce(trim(status::text), '')) NOT LIKE '%cerrad%'
       AND lower(coalesce(trim(status::text), '')) NOT LIKE '%cumpl%'
       AND lower(coalesce(trim(status::text), '')) NOT LIKE '%pagad%'
       AND (
            (submission_path IS NOT NULL AND length(trim(submission_path)) > 0)
         OR (submission_files IS NOT NULL AND submission_files::text NOT IN ('[]','null'))
         OR (coalesce(description::text, '') ~* '(\m|\n)Entrega:\s*entregas/')
       )
  )
  UPDATE asignaciones a
     SET id = a.id
    FROM c
   WHERE a.id = c.id;
  GET DIAGNOSTICS actualizadas = ROW_COUNT;
  RAISE NOTICE 'Backfill trigger asignaciones: % filas revisadas/marcadas', actualizadas;
END $$;
