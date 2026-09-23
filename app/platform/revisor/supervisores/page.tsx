import { PlatformShell } from "@/app/platform/platform-shell";
import { createClient } from "@/utils/supabase/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import {
  buildSections,
  resolveRoleForUser,
  type UserRole,
} from "@/lib/platform-roles";
import {
  SupervisoresCards,
  type SupervisorCardData,
} from "./supervisores-cards";

export const revalidate = 30;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const DEFAULT_AVATAR_BUCKET = "avatars";
const AVATAR_EXPIRES_SECONDS = 60 * 60;

const MONTH_LABELS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function getMonthRange(year: number, month0Idx: number): { startISO: string; endISO: string } {
  // month0Idx: 0 = Enero ... 11 = Diciembre
  const start = new Date(Date.UTC(year, month0Idx, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month0Idx + 1, 1, 0, 0, 0, 0));
  return {
    startISO: start.toISOString(),
    endISO: end.toISOString(),
  };
}

function monthKey(year: number, month0Idx: number) {
  // Formato "YYYY-MM"; month0Idx -> MM con 0..11 -> MM human-readable (1..12)
  return `${year}-${pad2(month0Idx + 1)}`;
}

function parseMonthKey(v: string | undefined): { year: number; month0Idx: number } | null {
  if (!v) return null;
  const match = /^(\d{4})-(\d{1,2})$/.exec(v.trim());
  if (!match) return null;
  const year = Number(match[1]);
  let mm = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(mm)) return null;
  const month0Idx = Math.min(11, Math.max(0, mm - 1));
  if (year < 2000 || year > 2100) return null;
  return { year, month0Idx };
}

function buildMonthOptions(currentYear: number): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [];
  // 12 meses del año en curso + los 12 del año anterior (para rango)
  for (let y = currentYear + 1; y >= currentYear - 1; y--) {
    for (let m = 11; m >= 0; m--) {
      opts.push({ value: monthKey(y, m), label: `${MONTH_LABELS[m]} ${y}` });
    }
  }
  // Colocar primero el más reciente arriba
  return opts;
}

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
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function classifyStatus(raw: unknown): "completadas" | "enCurso" | "pendientes" {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (s.includes("complet") || s.includes("done") || s.includes("finaliz")) {
    return "completadas";
  }
  if (s.includes("curso") || s.includes("progreso") || s.includes("progress")) {
    return "enCurso";
  }
  if (
    s.includes("open") || s.includes("nueva") || s.includes("nuevo") || s.includes("espera")) {
    if (s.includes("pend")) return "pendientes";
    return "enCurso";
  }
  if (s.includes("pend")) return "pendientes";
  return s.length === 0 ? "pendientes" : "pendientes";
}

function fallsInMonth(
  dateFields: { created_at?: unknown; due_at?: unknown; submitted_at?: unknown },
  startISO: string,
  endISO: string
): boolean {
  const candidates = [dateFields.created_at, dateFields.due_at, dateFields.submitted_at];
  for (const c of candidates) {
    if (typeof c !== "string" || !c) continue;
    try {
      const t = new Date(c).getTime();
      if (!Number.isFinite(t)) continue;
      if (t >= new Date(startISO).getTime() && t < new Date(endISO).getTime()) {
        return true;
      }
    } catch {
      /* ignore */
    }
  }
  return false;
}

function getSearchParam(sp: Record<string, string | string[] | undefined>, key: string) {
  const value = sp[key];
  return typeof value === "string" ? value : undefined;
}

export default async function SupervisoresPage({ searchParams }: { searchParams: SearchParams }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (
    !url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
    redirect("/?error=" + encodeURIComponent("Configura Supabase primero (env vars)."));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const role: UserRole = await resolveRoleForUser(supabase, user.id);
  if (role !== "revisor") {
    redirect("/platform?error=" + encodeURIComponent("Esta sección es sólo para revisores."));
  }
  const sections = buildSections(role);

  const sp = await searchParams;
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth0 = now.getUTCMonth();
  const parsedMonth = parseMonthKey(getSearchParam(sp, "month"));
  const selectedYear = parsedMonth ? parsedMonth.year : currentYear;
  const selectedMonth0 = parsedMonth ? parsedMonth.month0Idx : currentMonth0;
  const monthValue = parsedMonth
    ? monthKey(selectedYear, selectedMonth0)
    : monthKey(currentYear, currentMonth0);
  const monthOptions = buildMonthOptions(currentYear);
  const { startISO, endISO } = getMonthRange(selectedYear, selectedMonth0);
  const monthLabel = `${MONTH_LABELS[selectedMonth0]} ${selectedYear}`;

  if (!serviceKey || serviceKey.includes("__REPLACE_ME__")) {
    return (
      <PlatformShell
        sections={sections}
        currentUserId={user.id}
        currentUserEmail={user.email ?? undefined}
      >
        <div className="mx-auto max-w-6xl px-4 py-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Falta configurar <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> en{" "}
            <code className="font-mono">.env.local</code> para listar supervisores.
          </div>
        </div>
      </PlatformShell>
    );
  }

  const admin = createSupabaseAdminClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const catalogRolesQuery = await admin
    .from("roles")
    .select("id, code, name")
    .limit(50);

  const catalogRoles = (catalogRolesQuery.data ?? []) as {
    id?: unknown;
    code?: unknown;
    name?: unknown;
  }[];

  // ------------------------------------------------------------------
  // Paso 1: Obtener códigos de rol EXCLUSIVAMENTE desde catálogo `roles`.
  // Un código (roles.code) se considera "Supervisor" sólo si:
  //   - roles.id = 6  (fila de la imagen), o
  //   - roles.name = "Supervisor"
  // Así evitamos que el código "USUARIO" (id=2 del catálogo) sea tratado
  // como Supervisor aunque en user_roles aparezca como "2" genérico.
  // ------------------------------------------------------------------
  let supervisorRoleCodes: Set<string> = new Set();
  for (const r of catalogRoles) {
    const idNum =
      typeof r.id === "number" ? r.id : typeof r.id === "string" ? Number(r.id) : NaN;
    const nameStr = typeof r.name === "string" ? r.name.trim().toLowerCase() : "";
    const codeStr =
      typeof r.code === "string" ? r.code.trim() : String(r.code ?? "");
    const esFilaSupervisor = idNum === 6 || nameStr === "supervisor";

    if (esFilaSupervisor && codeStr) {
      supervisorRoleCodes.add(codeStr);
      supervisorRoleCodes.add(codeStr.toLowerCase());
    }
  }

  const userRolesQuery = await admin
    .from("user_roles")
    .select("user_id, role_code, created_at, updated_at")
    .limit(1000);

  const userRoleRows = (userRolesQuery.data ?? []) as {
    user_id?: unknown;
    role_code?: unknown;
  }[];

  const supervisorUserIds = new Set<string>();
  for (const row of userRoleRows) {
    const uid = typeof row.user_id === "string" ? row.user_id.trim() : "";
    if (!uid) continue;

    const rc = row.role_code;
    const rcStr =
      typeof rc === "string"
        ? rc.trim()
        : typeof rc === "number"
          ? String(rc)
          : "";

    const matches =
      supervisorRoleCodes.has(rcStr) ||
      (rcStr.length > 0 && supervisorRoleCodes.has(rcStr.toLowerCase()));

    if (matches) {
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
    const users = (listed as unknown as { data?: { users?: unknown } | null })?.data?.users;
    authUsers = (users as typeof authUsers) ?? [];
  } catch {
    authUsers = [];
  }

  const asignacionesQuery = await admin
    .from("asignaciones")
    .select("assigned_to_email, status, created_at, due_at, submitted_at")
    .limit(5000);

  const asignacionesRows = (asignacionesQuery.data ?? []) as {
    assigned_to_email?: unknown;
    status?: unknown;
    created_at?: unknown;
    due_at?: unknown;
    submitted_at?: unknown;
  }[];

  const statsByEmail = new Map<
    string,
    { completadas: number; enCurso: number; pendientes: number }
  >();
  for (const row of asignacionesRows) {
    // Filtro estricto POR MES: una asignación se incluye sólo si created_at / due_at / submitted_at
    // cae dentro del rango [startISO, endISO).
    if (!fallsInMonth(row, startISO, endISO)) continue;

    const email = normalizeEmail(
      typeof row.assigned_to_email === "string" ? row.assigned_to_email : null
    );
    if (!email) continue;
    const bucket = classifyStatus(row.status);
    const cur = statsByEmail.get(email) ?? {
      completadas: 0,
      enCurso: 0,
      pendientes: 0,
    };
    cur[bucket] = (cur[bucket] ?? 0) + 1;
    statsByEmail.set(email, cur);
  }

  type PreSupervisor = {
    id: string;
    email: string | null;
    displayName: string;
    avatarBucket: string;
    avatarPath: string;
    fallbackAvatar: string | null;
    stats: { completadas: number; enCurso: number; pendientes: number };
  };

  const preSupervisores: PreSupervisor[] = [];
  for (const u of authUsers) {
    if (!supervisorUserIds.has(u.id)) continue;

    const emailKey = normalizeEmail(u.email);
    const stats = statsByEmail.get(emailKey) ?? {
      completadas: 0,
      enCurso: 0,
      pendientes: 0,
    };

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
    const fallbackPicture =
      typeof (meta as { avatar_url?: unknown }).avatar_url === "string"
        ? (meta as { avatar_url: string }).avatar_url
        : typeof (meta as { picture?: unknown }).picture === "string"
          ? (meta as { picture: string }).picture
          : null;

    preSupervisores.push({
      id: u.id,
      email: u.email ?? null,
      displayName: deriveDisplayName(u.email ?? null, meta),
      avatarBucket: bucket,
      avatarPath: path,
      fallbackAvatar: fallbackPicture ?? null,
      stats,
    });
  }

  preSupervisores.sort((a, b) => {
    const an = a.displayName.toLowerCase();
    const bn = b.displayName.toLowerCase();
    if (an < bn) return -1;
    if (an > bn) return 1;
    return 0;
  });

  const resolvedAvatars: (string | null)[] = await Promise.all(
    preSupervisores.map(async (s) => {
      if (!s.avatarPath) return s.fallbackAvatar ?? null;
      try {
        const r = await admin.storage
          .from(s.avatarBucket)
          .createSignedUrl(s.avatarPath, AVATAR_EXPIRES_SECONDS);
        if (r?.data?.signedUrl && !r.error) return r.data.signedUrl;
      } catch {
        /* ignore */
      }
      return s.fallbackAvatar ?? null;
    })
  );

  const supervisores: SupervisorCardData[] = preSupervisores.map((s, i) => ({
    id: s.id,
    email: s.email,
    displayName: s.displayName,
    avatarUrl: resolvedAvatars[i] ?? null,
    stats: s.stats,
  }));

  return (
    <PlatformShell
      sections={sections}
      currentUserId={user.id}
      currentUserEmail={user.email ?? undefined}
    >
      <div className="w-full px-4 md:px-6 py-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900 tracking-tight">
              Supervisores
            </h1>
            <p className="text-sm text-zinc-500 mt-1">
              Panel de seguimiento de carga y progreso por supervisor ·{" "}
              <span className="font-medium text-zinc-700">{monthLabel}</span>
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="text-sm text-zinc-500">
              <span className="font-semibold text-zinc-800">{supervisores.length}</span>{" "}
              supervisor{supervisores.length === 1 ? "" : "es"}
            </div>
          </div>
        </div>

        <SupervisoresCards
          supervisores={supervisores}
          monthValue={monthValue}
          monthOptions={monthOptions}
        />
      </div>
    </PlatformShell>
  );
}
