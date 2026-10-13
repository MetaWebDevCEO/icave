-- ============================================================
-- monthly_dashboard_stats
-- Tabla de agregación mensual para el dashboard del Revisor.
-- Se actualiza automáticamente vía trigger sobre asignaciones.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.monthly_dashboard_stats (
    month_key              text PRIMARY KEY,            -- 'YYYY-MM' (UTC)
    total                  integer NOT NULL DEFAULT 0,
    completadas            integer NOT NULL DEFAULT 0,
    en_curso               integer NOT NULL DEFAULT 0,
    pendientes             integer NOT NULL DEFAULT 0,
    vencidas               integer NOT NULL DEFAULT 0,
    avance                 integer NOT NULL DEFAULT 0,   -- 0-100
    supervisor_compliance  jsonb   NOT NULL DEFAULT '[]'::jsonb,
    daily_series           jsonb   NOT NULL DEFAULT '[]'::jsonb,
    alto_impacto_total     integer NOT NULL DEFAULT 0,
    alto_impacto_completadas integer NOT NULL DEFAULT 0,
    alto_impacto_pendientes  integer NOT NULL DEFAULT 0,
    alto_impacto_avance    integer NOT NULL DEFAULT 0,
    dia_max_actividad      text,
    dia_max_entregas       integer NOT NULL DEFAULT 0,
    updated_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.monthly_dashboard_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "monthly_dashboard_stats - lectura autenticados"
    ON public.monthly_dashboard_stats;
CREATE POLICY "monthly_dashboard_stats - lectura autenticados"
    ON public.monthly_dashboard_stats
    FOR SELECT
    USING (auth.role() = 'authenticated');

COMMENT ON TABLE public.monthly_dashboard_stats IS
    'Agregados mensuales precalculados del dashboard del Revisor. Recalculada por trigger.';

-- ============================================================
-- Función: refresh_monthly_stats(p_month)
-- Reconstuye los agregados de un mes específico.
-- Lógica alineada con app/platform/revisor/page.tsx
-- ============================================================
CREATE OR REPLACE FUNCTION public.refresh_monthly_stats(p_month text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_year          int;
    v_month         int;
    v_month_start   timestamptz;
    v_month_end     timestamptz;
    v_days          int;
    v_total         int := 0;
    v_completadas   int := 0;
    v_en_curso      int := 0;
    v_pendientes    int := 0;
    v_vencidas      int := 0;
    v_avance        int := 0;
    v_sup           jsonb := '[]'::jsonb;
    v_daily         jsonb := '[]'::jsonb;
    v_ai_total      int := 0;
    v_ai_comp       int := 0;
    v_ai_pend       int := 0;
    v_ai_avance     int := 0;
    v_dia_max       text := NULL;
    v_dia_max_ent   int := 0;
    -- patrones de status
    -- "Entregada" cuenta como en_curso (entregado, pendiente de revisión), NO como completada
    c_status_comp   text := '(comp|done|termin|final|cerrad)';
    c_status_prog   text := '(prog|curso|inici|ejecu|desarr|entreg)';
    c_status_pend   text := '(pend|asign|abiert|nueva)';
BEGIN
    v_year  := split_part(p_month, '-', 1)::int;
    v_month := split_part(p_month, '-', 2)::int;

    v_month_start := make_timestamptz(v_year, v_month, 1, 0, 0, 0, 'UTC');
    v_month_end   := v_month_start + interval '1 month';
    v_days        := extract(day from (v_month_end - interval '1 day'))::int;

    -- monthRows: cualquier fecha (created/due/submitted) cae en el mes
    WITH month_rows AS (
        SELECT
            id,
            lower(coalesce(trim(status::text), ''))          AS status_lc,
            created_at,
            due_at,
            submitted_at,
            lower(coalesce(trim(priority::text), ''))        AS priority_lc,
            lower(coalesce(trim(assigned_to_email::text), '')) AS email_lc
        FROM asignaciones
        WHERE (created_at   >= v_month_start AND created_at   < v_month_end)
           OR (due_at       >= v_month_start AND due_at       < v_month_end)
           OR (submitted_at >= v_month_start AND submitted_at < v_month_end)
    ),
    kpis AS (
        SELECT
            count(*) AS total,
            count(*) FILTER (WHERE status_lc ~ c_status_comp) AS completadas,
            count(*) FILTER (
                WHERE status_lc ~ c_status_prog
                  AND NOT (status_lc ~ c_status_comp)
            ) AS en_curso,
            count(*) FILTER (
                WHERE (status_lc ~ c_status_pend OR status_lc = '')
                  AND NOT (status_lc ~ c_status_comp)
            ) AS pendientes,
            count(*) FILTER (
                WHERE NOT (status_lc ~ c_status_comp)
                  AND due_at IS NOT NULL
                  AND due_at < v_month_end
            ) AS vencidas
        FROM month_rows
    ),
    sup AS (
        SELECT coalesce(jsonb_agg(
            jsonb_build_object(
                'email',       email_lc,
                'total',       cnt,
                'completadas', comp,
                'avance',      CASE WHEN cnt > 0 THEN round(comp::numeric / cnt * 100) ELSE 0 END,
                'label',       substring(split_part(email_lc, '@', 1) from 1 for 22)
            ) ORDER BY (CASE WHEN cnt > 0 THEN round(comp::numeric / cnt * 100) ELSE 0 END) DESC, cnt DESC
        ), '[]'::jsonb) AS data
        FROM (
            SELECT
                email_lc,
                count(*) AS cnt,
                count(*) FILTER (WHERE status_lc ~ c_status_comp) AS comp
            FROM month_rows
            WHERE email_lc <> ''
            GROUP BY email_lc
        ) sub
    ),
    hi AS (
        SELECT
            count(*) AS total,
            count(*) FILTER (WHERE status_lc ~ c_status_comp) AS comp
        FROM month_rows
        WHERE
            CASE
                WHEN priority_lc = 'urgente' THEN true
                WHEN priority_lc LIKE '%no urg%' THEN false
                WHEN priority_lc LIKE '%urg%' THEN true
                ELSE false
            END
    )
    SELECT
        kpis.total, kpis.completadas, kpis.en_curso, kpis.pendientes, kpis.vencidas,
        CASE WHEN kpis.total > 0 THEN round(kpis.completadas::numeric / kpis.total * 100) ELSE 0 END AS avance,
        sup.data,
        hi.total, hi.comp,
        hi.total - hi.comp,
        CASE WHEN hi.total > 0 THEN round(hi.comp::numeric / hi.total * 100) ELSE 0 END
    INTO
        v_total, v_completadas, v_en_curso, v_pendientes, v_vencidas, v_avance,
        v_sup, v_ai_total, v_ai_comp, v_ai_pend, v_ai_avance
    FROM kpis, sup, hi;

    -- Daily series (usa TODAS las asignaciones, no sólo monthRows)
    WITH days AS (
        SELECT generate_series(1, v_days) AS day_num
    ),
    daily AS (
        SELECT
            d.day_num,
            (SELECT count(*) FROM asignaciones a
              WHERE a.created_at >= v_month_start + (d.day_num - 1) * interval '1 day'
                AND a.created_at <  v_month_start + d.day_num * interval '1 day') AS creadas,
            (SELECT count(*) FROM asignaciones a
              WHERE a.submitted_at >= v_month_start + (d.day_num - 1) * interval '1 day'
                AND a.submitted_at <  v_month_start + d.day_num * interval '1 day') AS entregadas
        FROM days d
    )
    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'dia',       day_num::text,
            'creadas',   creadas,
            'entregadas', entregadas,
            'total',     creadas + entregadas
        ) ORDER BY day_num
    ), '[]'::jsonb)
    INTO v_daily
    FROM daily;

    -- Día con mayor actividad (máximo de entregadas)
    SELECT dia, entregas
    INTO v_dia_max, v_dia_max_ent
    FROM (
        SELECT
            (elem->>'dia')::text        AS dia,
            (elem->>'entregadas')::int  AS entregas
        FROM jsonb_array_elements(v_daily) elem
    ) sub
    ORDER BY entregas DESC
    LIMIT 1;

    -- Upsert
    INSERT INTO public.monthly_dashboard_stats (
        month_key, total, completadas, en_curso, pendientes, vencidas, avance,
        supervisor_compliance, daily_series,
        alto_impacto_total, alto_impacto_completadas, alto_impacto_pendientes, alto_impacto_avance,
        dia_max_actividad, dia_max_entregas, updated_at
    ) VALUES (
        p_month, v_total, v_completadas, v_en_curso, v_pendientes, v_vencidas, v_avance,
        v_sup, v_daily,
        v_ai_total, v_ai_comp, v_ai_pend, v_ai_avance,
        v_dia_max, v_dia_max_ent, now()
    )
    ON CONFLICT (month_key) DO UPDATE SET
        total = EXCLUDED.total,
        completadas = EXCLUDED.completadas,
        en_curso = EXCLUDED.en_curso,
        pendientes = EXCLUDED.pendientes,
        vencidas = EXCLUDED.vencidas,
        avance = EXCLUDED.avance,
        supervisor_compliance = EXCLUDED.supervisor_compliance,
        daily_series = EXCLUDED.daily_series,
        alto_impacto_total = EXCLUDED.alto_impacto_total,
        alto_impacto_completadas = EXCLUDED.alto_impacto_completadas,
        alto_impacto_pendientes = EXCLUDED.alto_impacto_pendientes,
        alto_impacto_avance = EXCLUDED.alto_impacto_avance,
        dia_max_actividad = EXCLUDED.dia_max_actividad,
        dia_max_entregas = EXCLUDED.dia_max_entregas,
        updated_at = now();
END;
$$;

-- ============================================================
-- Función: refresh_all_monthly_stats()
-- Recalcula TODOS los meses presentes en asignaciones.
-- Útil para backfill y como fallback del trigger.
-- ============================================================
CREATE OR REPLACE FUNCTION public.refresh_all_monthly_stats()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    rec record;
BEGIN
    FOR rec IN
        SELECT DISTINCT m FROM (
            SELECT to_char(created_at, 'YYYY-MM')   AS m FROM asignaciones WHERE created_at   IS NOT NULL
            UNION
            SELECT to_char(due_at, 'YYYY-MM')       AS m FROM asignaciones WHERE due_at       IS NOT NULL
            UNION
            SELECT to_char(submitted_at, 'YYYY-MM') AS m FROM asignaciones WHERE submitted_at IS NOT NULL
        ) sub
        WHERE m IS NOT NULL
        ORDER BY m
    LOOP
        PERFORM public.refresh_monthly_stats(rec.m);
    END LOOP;
END;
$$;

-- ============================================================
-- Trigger: refrescar los meses afectados ante cambios en asignaciones
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_refresh_monthly_stats()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    rec record;
BEGIN
    -- Recalculamos todos los meses presentes (dataset pequeño)
    FOR rec IN
        SELECT DISTINCT m FROM (
            SELECT to_char(created_at, 'YYYY-MM')   AS m FROM asignaciones WHERE created_at   IS NOT NULL
            UNION
            SELECT to_char(due_at, 'YYYY-MM')       AS m FROM asignaciones WHERE due_at       IS NOT NULL
            UNION
            SELECT to_char(submitted_at, 'YYYY-MM') AS m FROM asignaciones WHERE submitted_at IS NOT NULL
        ) sub
        WHERE m IS NOT NULL
    LOOP
        PERFORM public.refresh_monthly_stats(rec.m);
    END LOOP;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_asignaciones_refresh_monthly_stats ON asignaciones;

CREATE TRIGGER trg_asignaciones_refresh_monthly_stats
AFTER INSERT OR UPDATE OR DELETE ON asignaciones
FOR EACH STATEMENT
EXECUTE FUNCTION public.trg_refresh_monthly_stats();

-- ============================================================
-- Backfill inicial: popular todos los meses existentes
-- ============================================================
SELECT public.refresh_all_monthly_stats();
