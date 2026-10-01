import { PlatformShell } from "@/app/platform/platform-shell";
import { createClient } from "@/utils/supabase/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import {
  buildSections,
  strongCheckIsRevisor,
  type UserRole,
} from "@/lib/platform-roles";
import { isSchemaMismatchPostgres } from "@/lib/submission-files";
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

const CANONICAL_SUPERVISOR_ROLE_CODES = new Set<string>([
  "2",
  "supervisor",
  "usuario",
  "admin",
  "administrador",
  "sup",
  "s",
]);

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function getMonthRange(year: number, month0Idx: number): { startISO: string; endISO: string } {
  const start = new Date(Date.UTC(year, month0Idx, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month0Idx + 1, 1, 0, 0, 0, 0));
  return {
    startISO: start.toISOString(),
    endISO: end.toISOString(),
  };
}

function monthKey(year: number, month0Idx: number) {
  return `${year}-${pad2(month0Idx + 1)}`;
}

function parseMonthKey(v: string | undefined): { year: number; month0Idx: number } | null {
  if (!v) return null;
  const match = /^(\d{4})-(\d{1,2})$/.exec(v.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(mm)) return null;
  const month0Idx = Math.min(11, Math.max(0, mm - 1));
  if (year < 2000 || year > 2100) return null;
  return { year, month0Idx };
}

function buildMonthOptions(currentYear: number): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [];
  for (let y = currentYear + 1; y >= currentYear - 1; y--) {
    for (let m = 11; m >= 0; m--) {
      opts.push({ value: monthKey(y, m), label: `${MONTH_LABELS[m]} ${y}` });
    }
  }
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
    s.includes("open") ||
    s.includes("nueva") ||
    s.includes("nuevo") ||
    s.includes("espera")
  ) {
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

function getSearchParam(
  sp: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = sp[key];
  return typeof value === "string" ? value : undefined;
}

function metadataLooksSupervisor(meta: unknown): boolean {
  if (!meta || typeof meta !== "object") return false;
  const m = meta as Record<string, unknown>;
  const role = typeof m.role === "string" ? m.role.trim().toLowerCase() : "";
  const rol = typeof m.rol === "string" ? m.rol.trim().toLowerCase() : "";
  const rolId =
    typeof m.rol_id === "string"
      ? m.rol_id.trim()
      : typeof m.rol_id === "number"
        ? String(m.rol_id)
        : "";
  const roleId =
    typeof m.role_id === "string"
      ? m.role_id.trim()
      : typeof m.role_id === "number"
        ? String(m.role_id)
        : "";

  if (role === "supervisor" || rol === "supervisor") return true;
  if (roleId === "2" || rolId === "2") return true;
  if (roleId === "6" || rolId === "6") return true;
  return false;
}

type CatalogRoleRow = {
  id?: unknown;
  code?: unknown;
  name?: unknown;
};

type UserRoleRow = {
  user_id?: unknown;
  role_code?: unknown;
};

type ProfileRow = {
  id?: unknown;
  user_id?: unknown;
  role_code?: unknown;
  rol?: unknown;
  role?: unknown;
  email?: unknown;
};

type AsignacionRow = {
  assigned_to_email?: unknown;
  status?: unknown;
  created_at?: unknown;
  due_at?: unknown;
  submitted_at?: unknown;
};

type AuthUserLite = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

export default async function SupervisoresPage({
  searchParams,
}: {
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

  let user: { id: string; email?: string | null; user_metadata?: unknown } | null =
    null;
  try {
    const resp = await supabase.auth.getUser();
    if (!resp.error && resp.data?.user) {
      user = resp.data.user;
    } else if (resp.error) {
      console.warn("[supervisores] getUser error:", resp.error.message);
    }
  } catch (e) {
    console.warn(
      "[supervisores] getUser exception:",
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
      "[supervisores] strongCheckIsRevisor exception:",
      e instanceof Error ? e.message : String(e)
    );
    role = "usuario";
  }
  if (role !== "revisor") {
    return redirect(
      "/platform?error=" +
        encodeURIComponent("Esta sección es sólo para revisores.")
    );
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

  const admin =
    serviceKey && !serviceKey.includes("__REPLACE_ME__")
      ? createSupabaseAdminClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;

  console.debug(
    "[supervisores:debug] admin client available?",
    Boolean(admin),
    "| user.id:",
    user.id,
    "| month:",
    monthValue
  );

  const queryClient = admin ?? supabase;

  let catalogRoles: CatalogRoleRow[] = [];
  try {
    const q = await queryClient
      .from("roles")
      .select("id, code, name")
      .limit(50);
    catalogRoles = (q.data ?? []) as CatalogRoleRow[];
    if (q.error && !isSchemaMismatchPostgres(q.error)) {
      console.warn("[supervisores] catalogRoles error:", q.error.message);
    }
  } catch (e) {
    console.warn(
      "[supervisores] catalogRoles exception:",
      e instanceof Error ? e.message : String(e)
    );
  }

  console.debug(
    "[supervisores:debug] catalogRoles.length =",
    catalogRoles.length
  );

  let supervisorRoleCodes: Set<string> = new Set(CANONICAL_SUPERVISOR_ROLE_CODES);
  for (const r of catalogRoles) {
    const idNum =
      typeof r.id === "number"
        ? r.id
        : typeof r.id === "string"
          ? Number(r.id)
          : NaN;
    const nameStr =
      typeof r.name === "string" ? r.name.trim().toLowerCase() : "";
    const codeStr =
      typeof r.code === "string" ? r.code.trim() : String(r.code ?? "");
    const esFilaSupervisor = idNum === 6 || nameStr === "supervisor";

    if (esFilaSupervisor && codeStr) {
      supervisorRoleCodes.add(codeStr);
      supervisorRoleCodes.add(codeStr.toLowerCase());
    }
  }

  console.debug(
    "[supervisores:debug] supervisorRoleCodes =",
    Array.from(supervisorRoleCodes)
  );

  let userRoleRows: UserRoleRow[] = [];
  try {
    const q = await queryClient
      .from("user_roles")
      .select("user_id, role_code, created_at, updated_at")
      .limit(1000);
    userRoleRows = (q.data ?? []) as UserRoleRow[];
    if (q.error && !isSchemaMismatchPostgres(q.error)) {
      console.warn("[supervisores] userRoles error:", q.error.message);
    }
  } catch (e) {
    console.warn(
      "[supervisores] userRoles exception:",
      e instanceof Error ? e.message : String(e)
    );
  }
  console.debug(
    "[supervisores:debug] userRoleRows.length =",
    userRoleRows.length
  );

  let profileRows: ProfileRow[] = [];
  try {
    const q = await queryClient
      .from("profiles")
      .select("id, user_id, role_code, rol, role, email")
      .limit(1000);
    profileRows = (q.data ?? []) as ProfileRow[];
    if (q.error && !isSchemaMismatchPostgres(q.error)) {
      console.warn("[supervisores] profiles error:", q.error.message);
    }
  } catch (e) {
    /* profiles table optional — schema cache / no table es fine */
  }
  console.debug(
    "[supervisores:debug] profileRows.length =",
    profileRows.length
  );

  const supervisorUserIds = new Set<string>();
  const supervisorEmails = new Set<string>();

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

  for (const p of profileRows) {
    const uid =
      typeof p.user_id === "string"
        ? p.user_id.trim()
        : typeof p.id === "string"
          ? p.id.trim()
          : "";
    if (!uid) continue;

    const fields = [p.role_code, p.rol, p.role];
    for (const f of fields) {
      const rcStr =
        typeof f === "string"
          ? f.trim()
          : typeof f === "number"
            ? String(f)
            : "";
      if (!rcStr) continue;
      const matches =
        supervisorRoleCodes.has(rcStr) ||
        supervisorRoleCodes.has(rcStr.toLowerCase());
      if (matches) {
        supervisorUserIds.add(uid);
        const email = normalizeEmail(
          typeof p.email === "string" ? p.email : null
        );
        if (email) supervisorEmails.add(email);
        break;
      }
    }
  }

  // auth.users: intentamos listUsers + fallback por IDs de user_roles + emails
  let authUsers: AuthUserLite[] = [];
  if (admin) {
    try {
      const listed = await (admin.auth as unknown as {
        admin: {
          listUsers?: (args: {
            page: number;
            perPage: number;
          }) => Promise<{ data?: { users?: Array<unknown> } | null }>;
          getUserById?: (
            id: string
          ) => Promise<{ data?: { user?: unknown } | null; error?: unknown | null }>;
        };
      }).admin;
      const listResult = await listed?.listUsers?.({
        page: 1,
        perPage: 1000,
      });
      const users = listResult?.data?.users as Array<unknown> | undefined;
      if (Array.isArray(users) && users.length > 0) {
        authUsers = (users as AuthUserLite[]) ?? [];
      } else {
        // Fallback: getUserById en lote sobre user_roles.user_id
        const ids = Array.from(supervisorUserIds).slice(0, 100);
        const resolved: AuthUserLite[] = [];
        for (const uid of ids) {
          try {
            const r = await listed?.getUserById?.(uid);
            const u = r?.data?.user as AuthUserLite | undefined;
            if (u?.id) resolved.push(u);
          } catch {
            /* ignore */
          }
        }
        authUsers = resolved;
      }
    } catch (e) {
      console.warn(
        "[supervisores] auth.users fallback:",
        e instanceof Error ? e.message : String(e)
      );
      authUsers = [];
    }
  } else {
    console.warn(
      "[supervisores] Sin Service Role Key → no podemos listar auth.users. " +
        "Se usan solo fuentes: user_roles, profiles, asignaciones emails."
    );
  }
  console.debug(
    "[supervisores:debug] authUsers.length =",
    authUsers.length
  );

  for (const u of authUsers) {
    if (metadataLooksSupervisor(u.user_metadata)) {
      supervisorUserIds.add(u.id);
      const email = normalizeEmail(u.email);
      if (email) supervisorEmails.add(email);
    }
  }

  let asignacionesRows: AsignacionRow[] = [];
  try {
    const q = await queryClient
      .from("asignaciones")
      .select("assigned_to_email, status, created_at, due_at, submitted_at")
      .limit(5000);
    asignacionesRows = (q.data ?? []) as AsignacionRow[];
    if (q.error && !isSchemaMismatchPostgres(q.error)) {
      console.warn("[supervisores] asignaciones error:", q.error.message);
    }
  } catch (e) {
    console.warn(
      "[supervisores] asignaciones exception:",
      e instanceof Error ? e.message : String(e)
    );
  }
  console.debug(
    "[supervisores:debug] asignacionesRows.length (total) =",
    asignacionesRows.length
  );

  const statsByEmail = new Map<
    string,
    { completadas: number; enCurso: number; pendientes: number }
  >();
  for (const row of asignacionesRows) {
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

  console.debug(
    "[supervisores:debug] statsByEmail.size (en mes) =",
    statsByEmail.size
  );
  if (statsByEmail.size > 0) {
    for (const [email, st] of statsByEmail.entries()) {
      console.debug(`[supervisores:debug] stats[${email}]=`, st);
    }
  }

  for (const email of statsByEmail.keys()) {
    supervisorEmails.add(email);
  }

  console.debug(
    "[supervisores:debug] supervisorUserIds.size =",
    supervisorUserIds.size,
    "| supervisorEmails.size =",
    supervisorEmails.size
  );

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
  const addedEmails = new Set<string>();
  const addedIds = new Set<string>();

  for (const u of authUsers) {
    const email = normalizeEmail(u.email);
    const byId = supervisorUserIds.has(u.id);
    const byEmail = email ? supervisorEmails.has(email) : false;
    if (!byId && !byEmail) continue;

    if (email) addedEmails.add(email);
    addedIds.add(u.id);

    const stats =
      email && statsByEmail.has(email)
        ? statsByEmail.get(email)!
        : { completadas: 0, enCurso: 0, pendientes: 0 };

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

  for (const email of supervisorEmails) {
    if (addedEmails.has(email)) continue;
    addedEmails.add(email);

    const stats = statsByEmail.get(email) ?? {
      completadas: 0,
      enCurso: 0,
      pendientes: 0,
    };

    const ghostId = `ghost:${email}`;
    preSupervisores.push({
      id: ghostId,
      email,
      displayName: deriveDisplayName(email, {}),
      avatarBucket: DEFAULT_AVATAR_BUCKET,
      avatarPath: "",
      fallbackAvatar: null,
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

  console.debug(
    "[supervisores:debug] preSupervisores.length =",
    preSupervisores.length
  );

  const resolvedAvatars: (string | null)[] = await Promise.all(
    preSupervisores.map(async (s) => {
      if (!s.avatarPath) return s.fallbackAvatar ?? null;
      if (!admin) return s.fallbackAvatar ?? null;
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
              <span className="font-semibold text-zinc-800">
                {supervisores.length}
              </span>{" "}
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
