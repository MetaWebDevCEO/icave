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
import {
  QuickAsignarFila,
  type MatrizOption as MatrizOpt,
  type SupervisorOption,
} from "./quick-asignar-fila";
import {
  ArchiveroMatrizList,
  type FilaMatriz,
} from "./archivero-matriz-list";

type MatrizRow = {
  id?: string | number | null;
  created_at?: string | null;
  actividad?: string | null;
  frecuencia?: string | null;
  [key: string]: unknown;
};

const SELECT_MATRIX_EXTENDED = "id, created_at, actividad, frecuencia";
const SELECT_MATRIX_BASE = "id, actividad, frecuencia";

const DEFAULT_AVATAR_BUCKET = "avatars";
const AVATAR_EXPIRES_SECONDS = 60 * 60;

function normalizeEmail(v: string | null | undefined): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

function deriveDisplayName(
  email: string | null | undefined,
  metadata: Record<string, unknown>
): string {
  const metadataName =
    typeof metadata.full_name === "string"
      ? metadata.full_name
      : typeof metadata.display_name === "string"
        ? metadata.display_name
        : typeof metadata.name === "string"
          ? metadata.name
          : "";
  if (metadataName.trim()) return metadataName.trim();
  if (!email) return "Sin nombre";
  const localPart = email.split("@")[0] ?? "supervisor";
  return localPart
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

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
    if (
      !existing ||
      (actividad.length > 0 && existing.actividad.length === 0) ||
      (frecuencia.length > 0 && existing.frecuencia.length === 0)
    ) {
      byId.set(numericId, {
        id: numericId,
        actividad,
        frecuencia,
        created_at: existing?.created_at ?? created_at,
      });
    }
  }

  const safeRows: FilaMatriz[] = [];
  const matrizOptions: MatrizOpt[] = [];
  for (let i = 1; i <= 64; i++) {
    const row = byId.get(i);
    const actividad = row?.actividad ?? "";
    safeRows.push({
      id: `matriz-${i}`,
      displayId: i,
      actividad,
      frecuencia: row?.frecuencia ?? "",
      created_at: row?.created_at ?? null,
    });
    matrizOptions.push({ id: i, actividad });
  }

  const total = safeRows.length;
  const definidas = safeRows.filter((r) => r.actividad.length > 0).length;
  const vacias = safeRows.filter((r) => r.actividad.length === 0).length;

  // ------------------------------------------------------------------
  // Supervisores para el diálogo "Asignar" (mismo criterio estricto que
  // la vista /platform/revisor/supervisores: join user_roles.role_code
  // con roles.code SÓLO de filas con roles.id = 6 o roles.name = Supervisor
  // ------------------------------------------------------------------
  const supervisores: SupervisorOption[] = await (async () => {
    if (!admin) return [];

    const catalogQ = await admin.from("roles").select("id, code, name").limit(50);
    const catalog = (catalogQ.data ?? []) as { id?: unknown; code?: unknown; name?: unknown }[];
    const supervisorCodes = new Set<string>();
    for (const r of catalog) {
      const idNum =
        typeof r.id === "number" ? r.id : typeof r.id === "string" ? Number(r.id) : NaN;
      const nameStr = typeof r.name === "string" ? r.name.trim().toLowerCase() : "";
      const codeStr = typeof r.code === "string" ? r.code.trim() : String(r.code ?? "");
      if ((idNum === 6 || nameStr === "supervisor") && codeStr) {
        supervisorCodes.add(codeStr);
        supervisorCodes.add(codeStr.toLowerCase());
      }
    }

    const urQ = await admin
      .from("user_roles")
      .select("user_id, role_code, created_at, updated_at")
      .limit(1000);
    const urRows = (urQ.data ?? []) as { user_id?: unknown; role_code?: unknown }[];
    const supervisorUserIds = new Set<string>();
    for (const row of urRows) {
      const uid = typeof row.user_id === "string" ? row.user_id.trim() : "";
      if (!uid) continue;
      const rc = row.role_code;
      const rcStr =
        typeof rc === "string" ? rc.trim() : typeof rc === "number" ? String(rc) : "";
      if (!rcStr) continue;
      if (supervisorCodes.has(rcStr) || supervisorCodes.has(rcStr.toLowerCase())) {
        supervisorUserIds.add(uid);
      }
    }

    let authUsers: Array<{
      id: string;
      email?: string | null;
      user_metadata?: Record<string, unknown> | null;
    }> = [];
    try {
      const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const maybe = (listed as unknown as { data?: { users?: unknown } | null })?.data?.users;
      authUsers = (maybe as typeof authUsers) ?? [];
    } catch {
      authUsers = [];
    }

    type Pre = {
      id: string;
      email: string | null;
      displayName: string;
      avatarBucket: string;
      avatarPath: string;
      fallbackUrl: string | null;
    };
    const pre: Pre[] = [];
    for (const u of authUsers) {
      if (!supervisorUserIds.has(u.id)) continue;
      const meta =
        u.user_metadata && typeof u.user_metadata === "object"
          ? (u.user_metadata as Record<string, unknown>)
          : {};
      const bucket =
        typeof meta.avatar_bucket === "string" && meta.avatar_bucket.trim()
          ? meta.avatar_bucket.trim()
          : DEFAULT_AVATAR_BUCKET;
      const path =
        typeof meta.avatar_path === "string" && meta.avatar_path.trim()
          ? meta.avatar_path.trim()
          : "";
      const fb =
        typeof (meta as { avatar_url?: unknown }).avatar_url === "string"
          ? (meta as { avatar_url: string }).avatar_url
          : typeof (meta as { picture?: unknown }).picture === "string"
            ? (meta as { picture: string }).picture
            : null;
      pre.push({
        id: u.id,
        email: u.email ?? null,
        displayName: deriveDisplayName(u.email ?? null, meta),
        avatarBucket: bucket,
        avatarPath: path,
        fallbackUrl: fb ?? null,
      });
    }
    pre.sort((a, b) => a.displayName.localeCompare(b.displayName));

    const resolved = await Promise.all(
      pre.map(async (s) => {
        if (!s.avatarPath) return s.fallbackUrl ?? null;
        try {
          const r = await admin.storage
            .from(s.avatarBucket)
            .createSignedUrl(s.avatarPath, AVATAR_EXPIRES_SECONDS);
          if (r?.data?.signedUrl && !r.error) return r.data.signedUrl;
        } catch {
          /* ignore */
        }
        return s.fallbackUrl ?? null;
      })
    );

    return pre.map((s, i) => ({
      id: s.id,
      email: s.email,
      displayName: s.displayName,
      avatarUrl: resolved[i] ?? null,
      userId: s.id,
    }));
  })();

  // ------------------------------------------------------------------
  // Paso 7: Supervisores ASIGNADOS DE FORMA PERSISTENTE por fila de matriz.
  // Vienen de la tabla `matriz_supervisor_asignado` (PK matriz_fila_id).
  // Se reutiliza al recargar, cerrar sesión, cambiar de mes, etc.
  // ------------------------------------------------------------------
  type AsignadoRow = {
    matriz_fila_id: unknown;
    supervisor_user_id: unknown;
  };
  const initialSupervisoresAsignados: Map<number, SupervisorOption> =
    admin
      ? await (async () => {
          try {
            const q = await admin
              .from("matriz_supervisor_asignado")
              .select("matriz_fila_id, supervisor_user_id")
              .limit(1000);
            if (q.error) return new Map<number, SupervisorOption>();
            const rows = (q.data ?? []) as AsignadoRow[];
            const byUid = new Map<string, SupervisorOption>();
            for (const s of supervisores) {
              byUid.set(s.userId ?? s.id, s);
            }
            const map = new Map<number, SupervisorOption>();
            for (const row of rows) {
              const filaNum =
                typeof row.matriz_fila_id === "number"
                  ? row.matriz_fila_id
                  : typeof row.matriz_fila_id === "string"
                    ? Number(row.matriz_fila_id)
                    : NaN;
              if (!Number.isInteger(filaNum)) continue;
              const uid =
                typeof row.supervisor_user_id === "string"
                  ? row.supervisor_user_id
                  : "";
              if (!uid) continue;
              const sup = byUid.get(uid);
              if (sup) map.set(filaNum, sup);
            }
            return map;
          } catch {
            return new Map<number, SupervisorOption>();
          }
        })()
      : new Map<number, SupervisorOption>();

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
          <ArchiveroMatrizList
            safeRows={safeRows}
            listErrorMessage={listError?.message ?? null}
            currentUserEmail={user.email ?? undefined}
            currentUserId={user.id}
            matrizOptions={matrizOptions}
            supervisores={supervisores}
            definidas={definidas}
            vacias={vacias}
            total={total}
            initialSupervisoresAsignados={initialSupervisoresAsignados}
          />
        </div>
      </div>
    </PlatformShell>
  );
}
