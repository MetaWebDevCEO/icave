import { PlatformShell } from "@/app/platform/platform-shell";
import type { SidebarSection } from "@/app/platform/components/sidebar";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import {
  resolveRoleForUser,
  buildSections,
  type UserRole,
} from "@/lib/platform-roles";
import {
  createClient as createSupabaseAdminClient,
  type PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { isSchemaMismatchPostgres } from "@/lib/submission-files";
import { formatCalendarDateShort } from "@/lib/calendar-date";

type MatrizRow = {
  id?: string | number | null;
  created_at?: string | null;
  actividad?: string | null;
  frecuencia?: string | null;
  [key: string]: unknown;
};

const SELECT_MATRIX_EXTENDED = "id, created_at, actividad, frecuencia";
const SELECT_MATRIX_BASE = "id, actividad, frecuencia";

export default async function ArchiveroPage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
    redirect("/?error=" + encodeURIComponent("Configura Supabase primero (env vars)."));
  }

  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    redirect("/auth/login");
  }

  let sections: SidebarSection[] = [];
  try {
    const role: UserRole = await resolveRoleForUser(supabase, user.id);
    sections = buildSections(role);
  } catch {
    sections = buildSections("revisor");
  }

  const admin =
    serviceKey && !serviceKey.includes("__REPLACE_ME__")
      ? createSupabaseAdminClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;

  const fetchMatriz = async (client: SupabaseClient) => {
    const extended = await client
      .from("matriz")
      .select(SELECT_MATRIX_EXTENDED)
      .limit(500);
    if (!isSchemaMismatchPostgres(extended.error)) return extended;

    return client
      .from("matriz")
      .select(SELECT_MATRIX_BASE)
      .limit(500);
  };

  const preferred = admin ?? supabase;
  let result = await fetchMatriz(preferred);
  let rows: MatrizRow[] = (result.data ?? []) as MatrizRow[];
  let listError: PostgrestError | null = result.error;

  if ((listError || rows.length === 0) && admin && preferred !== admin) {
    const fallback = await fetchMatriz(admin);
    rows = (fallback.data ?? []) as MatrizRow[];
    listError = fallback.error ?? listError;
  }

  const byId = new Map<number, { id: number; actividad: string; frecuencia: string; created_at: string | null }>();
  for (const r of rows) {
    const rawId = r.id;
    let numericId: number | null = null;
    if (typeof rawId === "number" && Number.isFinite(rawId)) {
      numericId = Math.round(rawId);
    } else if (typeof rawId === "string") {
      const n = Number(rawId.trim());
      if (Number.isFinite(n)) numericId = Math.round(n);
    }
    if (numericId === null || numericId < 1 || numericId > 64) continue;
    const actividadRaw = r.actividad;
    const frecuenciaRaw = r.frecuencia;
    const actividad = typeof actividadRaw === "string" ? actividadRaw.trim() : "";
    const frecuencia = typeof frecuenciaRaw === "string" ? frecuenciaRaw.trim() : "";
    const created_at = typeof r.created_at === "string" ? r.created_at : null;
    const existing = byId.get(numericId);
    if (!existing || (actividad.length > 0 && existing.actividad.length === 0) || (frecuencia.length > 0 && existing.frecuencia.length === 0)) {
      byId.set(numericId, { id: numericId, actividad, frecuencia, created_at: existing?.created_at ?? created_at });
    }
  }

  const safeRows: { id: string; displayId: number; actividad: string; frecuencia: string; created_at: string | null }[] = [];
  for (let i = 1; i <= 64; i++) {
    const row = byId.get(i);
    safeRows.push({
      id: `matriz-${i}`,
      displayId: i,
      actividad: row?.actividad ?? "",
      frecuencia: row?.frecuencia ?? "",
      created_at: row?.created_at ?? null,
    });
  }

  const total = safeRows.length;
  const definidas = safeRows.filter((r) => r.actividad.length > 0).length;
  const vacias = safeRows.filter((r) => r.actividad.length === 0).length;

  return (
    <PlatformShell
      sections={sections}
      currentUserId={user.id}
      currentUserEmail={user.email ?? undefined}
    >
      <div className="mx-auto flex h-[calc(100dvh-4rem)] max-w-6xl flex-col">
        <div className="shrink-0 pt-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-lg font-semibold">Archivero</h1>
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                Documentos, registros y matrices de control.
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 border-b border-zinc-200 dark:border-zinc-800">
            <button
              type="button"
              className="inline-flex items-center gap-2 border-b-2 border-zinc-900 px-3 py-2.5 text-sm font-medium text-zinc-950 dark:border-zinc-50 dark:text-zinc-50"
            >
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Matriz
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
              disabled
            >
              Documentos
            </button>
          </div>
        </div>

        <div className="mt-3 flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 pb-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                  Matriz de Control
                </div>
                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Seguimiento de actividades desde la tabla
                  <span className="ml-1 font-mono text-[11px] text-zinc-700 dark:text-zinc-300">matriz</span>
                  .
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-black dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  Exportar
                </button>
                <button
                  type="button"
                  className="inline-flex h-9 items-center justify-center rounded-md bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                >
                  Nueva fila
                </button>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <div className="grid grid-cols-12 sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50 px-5 py-3 text-xs font-semibold text-zinc-600 shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
              <div className="col-span-9">Actividad</div>
              <div className="col-span-2">Creada</div>
              <div className="col-span-1 text-right">Acciones</div>
            </div>

            <div className="max-h-[calc(100%-3rem)] overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-900">
              {listError && (
                <div className="px-5 py-8 text-sm text-red-700 dark:text-red-300">
                  {listError.message}
                </div>
              )}
              {!listError && safeRows.length === 0 && (
                <div className="px-5 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  La tabla <span className="font-mono">matriz</span> está vacía.
                </div>
              )}
              {!listError &&
                safeRows.map((r) => {
                  const createdLabel = r.created_at
                    ? formatCalendarDateShort(r.created_at)
                    : "—";
                  return (
                    <div
                      key={r.id}
                      className="grid grid-cols-12 items-center gap-3 px-5 py-4 text-sm text-zinc-700 dark:text-zinc-300"
                    >
                      <div className="col-span-9 truncate font-medium leading-snug text-zinc-950 dark:text-zinc-50" title={r.actividad}>
                        {r.actividad.length > 0 ? r.actividad : "—"}
                      </div>
                      <div className="col-span-2 truncate text-zinc-600 dark:text-zinc-400">
                        {createdLabel}
                      </div>
                      <div className="col-span-1 flex justify-end gap-2">
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-black dark:text-zinc-300 dark:hover:bg-zinc-900"
                          aria-label="Editar"
                        >
                          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="h-4 w-4">
                            <path d="M12 20h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                            <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-black dark:text-zinc-300 dark:hover:bg-zinc-900"
                          aria-label="Ver"
                        >
                          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="h-4 w-4">
                            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" stroke="currentColor" strokeWidth="2"/>
                            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      </div>
    </PlatformShell>
  );
}
