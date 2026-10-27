import { PlatformShell } from "@/app/platform/platform-shell";
import { Avatar } from "@/components/ui/avatar";
import { createClient } from "@/utils/supabase/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  buildSections,
  strongCheckIsRevisor,
  type UserRole,
} from "@/lib/platform-roles";
import { safeListUsers } from "@/lib/safe-auth";
import { isSchemaMismatchPostgres } from "@/lib/submission-files";
import { MonthFilter } from "../supervisores-cards";
import {
  MONTH_LABELS,
  buildMonthOptions,
  classifyStatus,
  deriveDisplayName,
  getMonthRange,
  monthKey,
  normalizeEmail,
  parseMonthKey,
  type StatusBucket,
} from "../shared";

export const revalidate = 30;

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const DEFAULT_AVATAR_BUCKET = "avatars";
const AVATAR_EXPIRES_SECONDS = 60 * 60;
const BASE_PATH = "/platform/revisor/supervisores";

const STATUS_META: Record<StatusBucket, { label: string; color: string; bg: string }> = {
  completadas: { label: "Completada", color: "#166534", bg: "#dcfce7" },
  entregadas: { label: "Entregada", color: "#5b21b6", bg: "#ede9fe" },
  pendientes: { label: "Pendiente", color: "#92400e", bg: "#fef3c7" },
};

const ASSIGNMENT_SELECTS = [
  "id, title, status, priority, created_at, due_at, submitted_at, completed_at",
  "id, title, status, priority, created_at, due_at, submitted_at",
  "id, title, status, created_at, due_at, submitted_at",
];

type AsignacionRow = {
  id?: unknown;
  title?: unknown;
  status?: unknown;
  priority?: unknown;
  created_at?: unknown;
  due_at?: unknown;
  submitted_at?: unknown;
  completed_at?: unknown;
};

type ProfileLookupRow = {
  id?: unknown;
  user_id?: unknown;
  email?: unknown;
};

function getSearchParam(
  sp: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = sp[key];
  return typeof value === "string" ? value : undefined;
}

function toDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDate(v: unknown): string {
  const d = toDate(v);
  if (!d) return "—";
  return d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Texto legible del estado tal como viene en la base, sin inventar valores. */
function statusLabel(raw: unknown, bucket: StatusBucket): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return STATUS_META[bucket].label;
  return s.replace(/[_-]+/g, " ").replace(/\s+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function priorityLabel(raw: unknown): string {
  const p = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!p) return "—";
  if (p.includes("urg") && !p.includes("no urg")) return "Urgente";
  if (p.includes("no urg")) return "No urgente";
  if (p.includes("med")) return "Medio";
  return raw && typeof raw === "string" ? raw : "—";
}

function buildTaskDetailHref(assignmentId: string, monthValue: string) {
  return `/platform/revisor/task?month=${encodeURIComponent(monthValue)}&assignment_id=${encodeURIComponent(assignmentId)}`;
}

function StatusBadge({
  raw,
  bucket,
  atrasada,
  extemporanea,
}: {
  raw: unknown;
  bucket: StatusBucket;
  atrasada: boolean;
  extemporanea: boolean;
}) {
  const meta = STATUS_META[bucket];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
        style={{ color: meta.color, backgroundColor: meta.bg }}
      >
        {statusLabel(raw, bucket)}
      </span>
      {atrasada ? (
        <span className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">
          Atrasada
        </span>
      ) : null}
      {extemporanea ? (
        <span className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">
          Extemporánea
        </span>
      ) : null}
    </div>
  );
}

function KpiTile({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white px-4 py-3 shadow-sm">
      <div className="text-2xl font-semibold leading-none" style={{ color: color ?? "#18181b" }}>
        {value}
      </div>
      <div className="mt-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </div>
    </div>
  );
}

export default async function SupervisorDetallePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (
    !url ||
    !anonKey ||
    url.includes("__REPLACE_ME__") ||
    anonKey.includes("__REPLACE_ME__")
  ) {
    return redirect(
      "/?error=" + encodeURIComponent("Configura Supabase primero (env vars).")
    );
  }

  const supabase = await createClient();

  let user: { id: string; email?: string | null; user_metadata?: unknown } | null = null;
  try {
    const resp = await supabase.auth.getUser();
    if (!resp.error && resp.data?.user) {
      user = resp.data.user;
    } else if (resp.error) {
      console.warn("[supervisor-detalle] getUser error:", resp.error.message);
    }
  } catch (e) {
    console.warn(
      "[supervisor-detalle] getUser exception:",
      e instanceof Error ? e.message : String(e)
    );
  }

  if (!user) {
    return redirect("/");
  }

  let role: UserRole = "usuario";
  try {
    const strong = await strongCheckIsRevisor(supabase, user.id, {
      email: user.email ?? null,
    });
    role = strong.decidedRole;
  } catch (e) {
    console.warn(
      "[supervisor-detalle] strongCheckIsRevisor exception:",
      e instanceof Error ? e.message : String(e)
    );
    role = "usuario";
  }
  if (role !== "revisor") {
    return redirect(
      "/platform?error=" + encodeURIComponent("Esta sección es sólo para revisores.")
    );
  }
  const sections = buildSections(role);

  const { id: rawId } = await params;
  const sp = await searchParams;

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const parsedMonth = parseMonthKey(getSearchParam(sp, "month"));
  const selectedYear = parsedMonth ? parsedMonth.year : currentYear;
  const selectedMonth0 = parsedMonth ? parsedMonth.month0Idx : now.getUTCMonth();
  const monthValue = monthKey(selectedYear, selectedMonth0);
  const monthOptions = buildMonthOptions(currentYear);
  const { startISO, endISO } = getMonthRange(selectedYear, selectedMonth0);
  const monthLabel = `${MONTH_LABELS[selectedMonth0]} ${selectedYear}`;

  const admin =
    serviceKey && !serviceKey.includes("__REPLACE_ME__")
      ? createSupabaseAdminClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;
  const queryClient = admin ?? supabase;

  // -------------------------------------------------------------------
  // Identidad del supervisor: el parámetro puede ser su correo o su id.
  // -------------------------------------------------------------------
  const key = (rawId ?? "").trim();
  const keyWithoutGhostPrefix = key.startsWith("ghost:") ? key.slice(6).trim() : key;
  const keyAsEmail = keyWithoutGhostPrefix.includes("@")
    ? normalizeEmail(keyWithoutGhostPrefix)
    : "";

  const directory = await safeListUsers({ perPage: 1000, label: "supervisores:detalle" });
  const directoryUser =
    directory.find(
      (u) =>
        (keyAsEmail !== "" && normalizeEmail(u.email) === keyAsEmail) ||
        u.id === key ||
        u.id === keyWithoutGhostPrefix
    ) ?? null;

  let profileUser: ProfileLookupRow | null = null;
  try {
    const q = await queryClient
      .from("profiles")
      .select("id, user_id, email")
      .limit(2000);
    if (!q.error) {
      const profiles = (q.data ?? []) as ProfileLookupRow[];
      profileUser =
        profiles.find((p) => {
          const profileId = typeof p.id === "string" ? p.id.trim() : "";
          const profileUserId = typeof p.user_id === "string" ? p.user_id.trim() : "";
          const profileEmail = normalizeEmail(typeof p.email === "string" ? p.email : null);
          return (
            (keyAsEmail !== "" && profileEmail === keyAsEmail) ||
            profileId === key ||
            profileUserId === key ||
            profileId === keyWithoutGhostPrefix ||
            profileUserId === keyWithoutGhostPrefix
          );
        }) ?? null;
    }
  } catch {
    /* profiles es opcional */
  }

  const email =
    keyAsEmail ||
    normalizeEmail(directoryUser?.email) ||
    normalizeEmail(typeof profileUser?.email === "string" ? profileUser.email : null);
  const metadata = directoryUser?.user_metadata ?? {};
  const displayName = deriveDisplayName(email || directoryUser?.email, metadata);

  let avatarUrl: string | null = null;
  const avatarBucket =
    typeof metadata.avatar_bucket === "string" && metadata.avatar_bucket.trim()
      ? metadata.avatar_bucket.trim()
      : DEFAULT_AVATAR_BUCKET;
  const avatarPath =
    typeof metadata.avatar_path === "string" && metadata.avatar_path.trim()
      ? metadata.avatar_path.trim()
      : "";
  if (admin && avatarPath) {
    try {
      const r = await admin.storage
        .from(avatarBucket)
        .createSignedUrl(avatarPath, AVATAR_EXPIRES_SECONDS);
      if (r?.data?.signedUrl && !r.error) avatarUrl = r.data.signedUrl;
    } catch {
      /* el Avatar cae a iniciales */
    }
  }
  if (!avatarUrl && typeof metadata.avatar_url === "string" && metadata.avatar_url.trim()) {
    avatarUrl = metadata.avatar_url.trim();
  }

  // -------------------------------------------------------------------
  // Asignaciones del supervisor, sólo del mes seleccionado.
  // -------------------------------------------------------------------
  let rows: AsignacionRow[] = [];
  let queryError = "";
  if (email) {
    for (const select of ASSIGNMENT_SELECTS) {
      try {
        const q = await queryClient
          .from("asignaciones")
          .select(select)
          .eq("assigned_to_email", email)
          .gte("created_at", startISO)
          .lt("created_at", endISO)
          .order("due_at", { ascending: true, nullsFirst: false })
          .limit(2000);
        if (!q.error) {
          rows = (q.data ?? []) as unknown as AsignacionRow[];
          queryError = "";
          break;
        }
        queryError = q.error.message;
        if (!isSchemaMismatchPostgres(q.error)) {
          console.warn("[supervisor-detalle] asignaciones error:", q.error.message);
          break;
        }
      } catch (e) {
        queryError = e instanceof Error ? e.message : String(e);
        console.warn("[supervisor-detalle] asignaciones exception:", queryError);
        break;
      }
    }
  }

  const total = rows.length;
  const stats = rows.reduce(
    (acc, row) => {
      const bucket = classifyStatus(row.status);
      acc[bucket] += 1;
      return acc;
    },
    { completadas: 0, entregadas: 0, pendientes: 0 } as Record<StatusBucket, number>
  );

  const atrasadas = rows.filter((row) => {
    const bucket = classifyStatus(row.status);
    if (bucket === "completadas") return false;
    const due = toDate(row.due_at);
    return due ? now.getTime() > due.getTime() : false;
  }).length;

  return (
    <PlatformShell
      sections={sections}
      currentUserId={user.id}
      currentUserEmail={user.email ?? undefined}
    >
      <div className="w-full px-4 md:px-6 py-6 max-w-[1200px] mx-auto">
        <Link
          href={`${BASE_PATH}?month=${encodeURIComponent(monthValue)}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 transition-colors"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Supervisores
        </Link>

        <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-200 pb-5">
          <div className="flex items-center gap-4 min-w-0">
            <Avatar
              src={avatarUrl}
              alt={displayName}
              initials={displayName || (email || undefined)}
              className="w-14 h-14 text-lg ring-1 ring-zinc-200 dark:ring-zinc-200"
            />
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-zinc-900 tracking-tight truncate">
                {displayName}
              </h1>
              <p className="text-sm text-zinc-500 truncate mt-0.5">
                {email || "Sin correo registrado"}
              </p>
              <p className="text-xs text-zinc-400 mt-1">
                Estatus de las tareas asignadas ·{" "}
                <span className="font-medium text-zinc-600">{monthLabel}</span>
              </p>
            </div>
          </div>
          <MonthFilter value={monthValue} options={monthOptions} />
        </div>

        {!email ? (
          <div className="mt-10 w-full py-16 flex flex-col items-center justify-center text-center">
            <h3 className="text-sm font-semibold text-zinc-700 mb-1">
              No se pudo identificar a este supervisor
            </h3>
            <p className="text-xs text-zinc-500 max-w-md">
              No tiene correo registrado ni existe en la lista de usuarios, así que no es
              posible consultar sus asignaciones.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <KpiTile label="Asignadas" value={total} />
              <KpiTile label="Completadas" value={stats.completadas} color="#16a34a" />
              <KpiTile label="Entregadas" value={stats.entregadas} color="#7c3aed" />
              <KpiTile label="Pendientes" value={stats.pendientes} color="#f59e0b" />
              <KpiTile label="Atrasadas" value={atrasadas} color="#e11d48" />
            </div>

            {queryError && total === 0 ? (
              <div className="mt-5 rounded-xl border border-zinc-200/80 bg-white px-4 py-3 text-xs text-zinc-500 shadow-sm">
                No se pudieron leer las asignaciones de este periodo.
              </div>
            ) : null}

            {total === 0 ? (
              <div className="mt-10 w-full py-16 flex flex-col items-center justify-center text-center">
                <div className="w-14 h-14 rounded-full bg-zinc-100 flex items-center justify-center mb-4">
                  <svg
                    className="w-7 h-7 text-zinc-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                </div>
                <h3 className="text-sm font-semibold text-zinc-700 mb-1">
                  Sin tareas asignadas en {monthLabel}
                </h3>
                <p className="text-xs text-zinc-500 max-w-sm">
                  Este supervisor no tiene asignaciones creadas en el mes seleccionado.
                </p>
              </div>
            ) : (
              <div className="mt-5 rounded-xl border border-zinc-200/80 bg-white shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50/60 text-[11px] uppercase tracking-wide text-zinc-500">
                      <th className="px-4 py-2.5 text-left font-medium">Actividad</th>
                      <th className="px-4 py-2.5 text-left font-medium">Estado</th>
                      <th className="px-4 py-2.5 text-left font-medium">Prioridad</th>
                      <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">
                        Publicada
                      </th>
                      <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">
                        Fecha límite
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {rows.map((row) => {
                      const bucket = classifyStatus(row.status);
                      const due = toDate(row.due_at);
                      const atrasada =
                        bucket !== "completadas" && due ? now.getTime() > due.getTime() : false;
                      const extemporanea =
                        bucket === "completadas" &&
                        due &&
                        (toDate(row.completed_at) ?? toDate(row.submitted_at))
                          ? (toDate(row.completed_at) ?? toDate(row.submitted_at))!.getTime() >
                            due.getTime()
                          : false;

                      return (
                        <tr key={String(row.id)} className="align-top">
                          <td className="px-4 py-3 text-zinc-800">
                            <div className="flex flex-col gap-2">
                              <div>
                                {typeof row.title === "string" && row.title.trim()
                                  ? row.title.trim()
                                  : "Sin título"}
                              </div>
                              <Link
                                href={buildTaskDetailHref(String(row.id ?? ""), monthValue)}
                                className="inline-flex w-fit items-center rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                              >
                                Ir a actividad
                              </Link>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge
                              raw={row.status}
                              bucket={bucket}
                              atrasada={atrasada}
                              extemporanea={extemporanea}
                            />
                          </td>
                          <td className="px-4 py-3 text-zinc-600 whitespace-nowrap">
                            {priorityLabel(row.priority)}
                          </td>
                          <td className="px-4 py-3 text-zinc-600 whitespace-nowrap">
                            {fmtDate(row.created_at)}
                          </td>
                          <td className="px-4 py-3 text-zinc-600 whitespace-nowrap">
                            {fmtDate(row.due_at)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </PlatformShell>
  );
}
