import { PlatformShell } from "@/app/platform/platform-shell";
import type { SidebarSection } from "@/app/platform/components/sidebar";
import { createClient } from "@/utils/supabase/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { RolesTable } from "@/app/platform/settings/roles/roles-table";
import {
  strongCheckIsRevisor,
  buildSections,
  type UserRole,
} from "@/lib/platform-roles";
import { isSchemaMismatchPostgres } from "@/lib/submission-files";
import {
  safeListUsers,
  safeFillMissingUsersById,
  type SafeFullAuthUser,
} from "@/lib/safe-auth";

function isNextRedirectError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { digest?: unknown; message?: unknown };
  if (typeof e.digest === "string" && e.digest.startsWith("NEXT_REDIRECT")) return true;
  if (typeof e.message === "string" && e.message.includes("NEXT_REDIRECT")) return true;
  return false;
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type RoleOption = {
  code: string;
  label: string;
};

const DEFAULT_ROLE_CODES = ["revisor", "usuario"] as const;
type DefaultRoleCode = (typeof DEFAULT_ROLE_CODES)[number];
const DEFAULT_ROLE_LABELS: Record<DefaultRoleCode, string> = {
  revisor: "Revisor",
  usuario: "Supervisor",
};
const DEFAULT_ROLE_NUMERIC: Record<DefaultRoleCode, number> = {
  revisor: 1,
  usuario: 2,
};
const NUMERIC_TO_DEFAULT: Record<number, DefaultRoleCode> = {
  1: "revisor",
  2: "usuario",
};

type CanonicalRoleKey = "revisor" | "usuario";
const CANONICAL_ALIASES: Record<CanonicalRoleKey, string[]> = {
  revisor: ["revisor", "reviewer", "rev", "r", "1", "admin", "administrador"],
  usuario: [
    "usuario",
    "supervisor",
    "sup",
    "s",
    "user",
    "2",
    "supervisores",
    "super",
  ],
};

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email || typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed;
}

function deriveDisplayName(
  email: string | null | undefined,
  metadata: Record<string, unknown>
) {
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

  const localPart = email.split("@")[0] ?? "usuario";
  return localPart
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function getSignedAvatarUrl(
  admin: {
    storage: {
      from: (
        bucket: string
      ) => {
        createSignedUrl: (
          path: string,
          expiresIn: number
        ) => Promise<{
          data: { signedUrl: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
  },
  metadata: Record<string, unknown>
) {
  const bucket =
    typeof metadata.avatar_bucket === "string" && metadata.avatar_bucket.trim()
      ? metadata.avatar_bucket.trim()
      : "avatars";
  const path =
    typeof metadata.avatar_path === "string" && metadata.avatar_path.trim()
      ? metadata.avatar_path.trim()
      : "";

  if (!path) return null;

  try {
    const { data, error } = await admin
      .storage
      .from(bucket)
      .createSignedUrl(path, 8 * 60 * 60);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

function resolveCanonicalRoleFromUnknown(
  value: unknown
): CanonicalRoleKey | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    if (value === 1) return "revisor";
    if (value === 2) return "usuario";
    return null;
  }

  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  const n = raw.toLowerCase();

  for (const key of Object.keys(CANONICAL_ALIASES) as CanonicalRoleKey[]) {
    if (CANONICAL_ALIASES[key].includes(n)) return key;
  }
  return null;
}

function roleRecordToCodeAndLabel(
  rec: Record<string, unknown>
): { code: string; label: string; canonicalKey: CanonicalRoleKey | null } | null {
  const codeRaw =
    (rec as { code?: unknown }).code ??
    (rec as { role_code?: unknown }).role_code ??
    (rec as { id?: unknown }).id ??
    null;
  const nameRaw =
    (rec as { name?: unknown }).name ??
    (rec as { label?: unknown }).label ??
    (rec as { role?: unknown }).role ??
    (rec as { descripcion?: unknown }).descripcion ??
    null;

  const canonicalKey =
    resolveCanonicalRoleFromUnknown(codeRaw) ??
    resolveCanonicalRoleFromUnknown(nameRaw);

  if (!codeRaw && !nameRaw) return null;

  const codeStr =
    canonicalKey ??
    (typeof codeRaw === "string" && codeRaw.trim()
      ? codeRaw.trim()
      : typeof codeRaw === "number"
        ? String(codeRaw)
        : typeof nameRaw === "string" && nameRaw.trim()
          ? nameRaw.trim().toLowerCase().replace(/\s+/g, "_")
          : "");
  if (!codeStr) return null;

  const labelStr =
    typeof nameRaw === "string" && nameRaw.trim()
      ? nameRaw.trim()
      : canonicalKey && canonicalKey in DEFAULT_ROLE_LABELS
        ? DEFAULT_ROLE_LABELS[canonicalKey as DefaultRoleCode]
        : codeStr;

  return { code: codeStr, label: labelStr, canonicalKey };
}

function roleRowToCanonicalNumericKey(
  canonicalKey: CanonicalRoleKey | null,
  codeRaw: unknown,
  labelRaw: unknown
): number | null {
  if (canonicalKey && canonicalKey in DEFAULT_ROLE_NUMERIC) {
    return DEFAULT_ROLE_NUMERIC[canonicalKey as DefaultRoleCode];
  }
  const byCode = resolveCanonicalRoleFromUnknown(codeRaw);
  if (byCode && byCode in DEFAULT_ROLE_NUMERIC) {
    return DEFAULT_ROLE_NUMERIC[byCode as DefaultRoleCode];
  }
  const byLabel = resolveCanonicalRoleFromUnknown(labelRaw);
  if (byLabel && byLabel in DEFAULT_ROLE_NUMERIC) {
    return DEFAULT_ROLE_NUMERIC[byLabel as DefaultRoleCode];
  }
  return null;
}

function getSearchParam(
  sp: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = sp[key];
  return typeof value === "string" ? value : undefined;
}

function normalizeAssignableRoleCode(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const v = value.trim();
  const key = resolveCanonicalRoleFromUnknown(v);
  if (key) return key;
  return v;
}

export default async function RolesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
  let user: { id: string; email?: string | null; user_metadata: unknown } | null =
    null;
  try {
    const resp = await supabase.auth.getUser();
    if (!resp.error && resp.data?.user) {
      user = resp.data.user;
    } else if (resp.error) {
      console.debug("[roles] getUser error:", resp.error.message);
    }
  } catch (e) {
    console.debug(
      "[roles] getUser exception:",
      e instanceof Error ? e.message : String(e)
    );
  }

  if (!user) {
    return redirect("/auth/login");
  }

  let sections: SidebarSection[] = [];
  let currentRole: UserRole = "usuario";
  try {
    const strongCheck = await strongCheckIsRevisor(supabase, user.id, {
      email: user.email ?? null,
    });
    currentRole = strongCheck.decidedRole;
    if (currentRole !== "revisor") {
      return redirect(
        "/platform?error=" +
          encodeURIComponent("Esta sección es sólo para revisores.")
      );
    }
    sections = buildSections(currentRole);
  } catch (e) {
    const digest = (e as { digest?: unknown }).digest;
    if (typeof digest === "string") {
      if (digest.startsWith("NEXT_REDIRECT")) {
        console.debug("[roles] strongCheck lanzó NEXT_REDIRECT, no re-lanzamos.");
      } else if (digest.startsWith("NEXT_NOTFOUND")) {
        console.debug("[roles] strongCheck lanzó NEXT_NOTFOUND, no re-lanzamos.");
      }
    } else {
      console.debug(
        "[roles] strongCheck exception:",
        e instanceof Error ? e.message : String(e)
      );
    }
    currentRole = "usuario";
    sections = buildSections("revisor");
  }

  const sp = await searchParams;
  const errorParam = getSearchParam(sp, "error");
  const messageParam = getSearchParam(sp, "message");

  let roleOptions: RoleOption[] = DEFAULT_ROLE_CODES.map((code) => ({
    code,
    label: DEFAULT_ROLE_LABELS[code],
  })).reverse();
  let allUsersList: Array<{
    id: string;
    email: string | null;
    createdAt: string | null;
    user_metadata: unknown;
  }> = [];
  const roleByUserId: Record<string, string> = {};

  const haveServiceRole = Boolean(
    serviceKey && !serviceKey.includes("__REPLACE_ME__")
  );
  let admin: ReturnType<typeof createSupabaseAdminClient> | null = null;
  if (haveServiceRole && serviceKey) {
    admin = createSupabaseAdminClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async function updateUserRole(
    formData: FormData
  ): Promise<{ ok: boolean; url: string }> {
    "use server";

    const srvUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const srvAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const srvService = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const baseUrl = "/platform/settings/roles";

    if (
      !srvUrl ||
      !srvAnon ||
      srvUrl.includes("__REPLACE_ME__") ||
      srvAnon.includes("__REPLACE_ME__")
    ) {
      return {
        ok: false,
        url: "/?error=" + encodeURIComponent("Configura Supabase primero (env vars)."),
      };
    }

    if (!srvService || srvService.includes("__REPLACE_ME__")) {
      return {
        ok: false,
        url: baseUrl + "?error=" + encodeURIComponent("Falta SUPABASE_SERVICE_ROLE_KEY."),
      };
    }

    const srvSupabase = await createClient();
    let callerUser: {
      id: string;
      email?: string | null;
    } | null = null;
    try {
      const resp = await srvSupabase.auth.getUser();
      if (!resp.error && resp.data?.user) callerUser = resp.data.user;
    } catch {
      callerUser = null;
    }

    if (!callerUser) {
      return { ok: false, url: "/auth/login" };
    }

    let callerIsRevisor = false;
    try {
      const c = await strongCheckIsRevisor(srvSupabase, callerUser.id, {
        email: callerUser.email ?? null,
      });
      callerIsRevisor = c.isRevisor;
    } catch {
      callerIsRevisor = false;
    }
    if (!callerIsRevisor) {
      return {
        ok: false,
        url: baseUrl + "?error=" + encodeURIComponent("No tienes permisos para cambiar roles."),
      };
    }

    const targetUserId = String(formData.get("user_id") ?? "");
    const rawRoleCode = formData.get("role_code");

    if (!targetUserId || typeof rawRoleCode !== "string" || !rawRoleCode.trim()) {
      return {
        ok: false,
        url: baseUrl + "?error=" + encodeURIComponent("Faltan datos para actualizar el rol."),
      };
    }

    const roleCode = normalizeAssignableRoleCode(rawRoleCode);
    if (!roleCode) {
      return {
        ok: false,
        url: baseUrl + "?error=" + encodeURIComponent("role_code no permitido."),
      };
    }

    const canonical = resolveCanonicalRoleFromUnknown(roleCode);
    if (!canonical) {
      return {
        ok: false,
        url: baseUrl + "?error=" + encodeURIComponent("role_code fuera de catálogo permitido."),
      };
    }
    const roleCodeNumeric = DEFAULT_ROLE_NUMERIC[canonical];

    const srvAdmin = createSupabaseAdminClient(srvUrl, srvService, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    try {
      const { error } = await srvAdmin
        .from("user_roles")
        .upsert({ user_id: targetUserId, role_code: roleCodeNumeric }, { onConflict: "user_id" });

      if (error) {
        return {
          ok: false,
          url: baseUrl + "?error=" + encodeURIComponent(error.message),
        };
      }
    } catch (e) {
      if (isNextRedirectError(e)) throw e;
      return {
        ok: false,
        url:
          baseUrl +
          "?error=" +
          encodeURIComponent(e instanceof Error ? e.message : String(e)),
      };
    }

    return {
      ok: true,
      url: baseUrl + "?message=" + encodeURIComponent("Rol actualizado."),
    };
  }

  try {
    if (admin) {
      const knownIdsFromRoleRows: string[] = [];
      const publicEmailByUserId: Record<string, string | null> = {};

      async function safeWideSelect<T extends Record<string, unknown>>(
        table: string,
        wideCols: string,
        narrowCols: string,
        opts: { limit?: number } = {}
      ): Promise<T[]> {
        const limit = opts.limit ?? 5000;
        for (const cols of [wideCols, narrowCols]) {
          try {
            const q = await admin!
              .from(table)
              .select(cols)
              .limit(limit);
            if (!q.error && q.data) return q.data as unknown as T[];
            if (q.error) {
              const msg = (q.error.message ?? "").toLowerCase();
              const code = q.error.code ?? "";
              const isMissingCol =
                code === "42703" ||
                msg.includes("column") && msg.includes("does not exist");
              if (!isMissingCol) {
                console.debug(`[roles] ${table}.select(${cols}) error:`, q.error.message);
                break;
              }
              console.debug(`[roles] ${table}.select wide falló (col faltante): ${q.error.message}. Reintento con narrow: ${narrowCols}.`);
            }
          } catch (e) {
            console.debug(`[roles] ${table}.select(${cols}) exception:`, e instanceof Error ? e.message : String(e));
          }
        }
        return [];
      }

      try {
        const rows = await safeWideSelect<Record<string, unknown>>(
          "user_roles",
          "user_id, role_code, email, created_at, updated_at",
          "user_id, role_code"
        );
        for (const r of rows) {
          if (typeof r.user_id === "string" && r.user_id) {
            knownIdsFromRoleRows.push(r.user_id);
            const emailRaw = (r as { email?: unknown }).email;
            if (typeof emailRaw === "string" && emailRaw && !(r.user_id in publicEmailByUserId)) {
              publicEmailByUserId[r.user_id] = emailRaw;
            }
          }
          const canonicalKey = resolveCanonicalRoleFromUnknown(r.role_code);
          if (canonicalKey && typeof r.user_id === "string" && r.user_id) {
            roleByUserId[r.user_id] = canonicalKey;
          }
        }
      } catch (e) {
        console.debug("[roles] user_roles carga general exception:", e instanceof Error ? e.message : String(e));
      }

      const knownIdsFromProfiles: string[] = [];
      try {
        const rows = await safeWideSelect<Record<string, unknown>>(
          "profiles",
          "id, email, full_name, display_name, name, created_at, updated_at",
          "id, email"
        );
        for (const r of rows) {
          if (typeof r.id === "string" && r.id) {
            knownIdsFromProfiles.push(r.id);
            const emailRaw = (r as { email?: unknown }).email;
            if (typeof emailRaw === "string" && emailRaw && !(r.id in publicEmailByUserId)) {
              publicEmailByUserId[r.id] = emailRaw;
            }
          }
        }
      } catch (e) {
        console.debug("[roles] profiles carga general exception:", e instanceof Error ? e.message : String(e));
      }

      try {
        const q = await admin
          .from("roles")
          .select("id, name, code, role_code, label, role, descripcion")
          .limit(200);
        if (!q.error && q.data && q.data.length > 0) {
          const parsed: RoleOption[] = [];
          for (const row of q.data) {
            const rec = (row ?? {}) as Record<string, unknown>;
            const parsedRole = roleRecordToCodeAndLabel(rec);
            if (!parsedRole) continue;
            if (!parsed.some((p) => p.code === parsedRole.code)) {
              parsed.push({ code: parsedRole.code, label: parsedRole.label });
            }
          }
          if (parsed.length > 0) {
            const order: CanonicalRoleKey[] = ["usuario", "revisor"];
            parsed.sort((a, b) => {
              const ca = resolveCanonicalRoleFromUnknown(a.code);
              const cb = resolveCanonicalRoleFromUnknown(b.code);
              const ia = ca ? order.indexOf(ca) : 99;
              const ib = cb ? order.indexOf(cb) : 99;
              if (ia !== ib) return ia - ib;
              return a.label.localeCompare(b.label);
            });
            roleOptions = parsed;
          }
        } else if (q.error && !isSchemaMismatchPostgres(q.error)) {
          console.debug("[roles] roles catalog error:", q.error.message);
        }
      } catch (e) {
        console.debug(
          "[roles] roles catalog exception:",
          e instanceof Error ? e.message : String(e)
        );
      }

      const usersMap = new Map<
        string,
        { id: string; email: string | null; createdAt: string | null; user_metadata: unknown }
      >();

      try {
        const listed = await safeListUsers({ perPage: 500, page: 1, label: "roles-listUsers" });
        for (const u of listed) {
          usersMap.set(u.id, {
            id: u.id,
            email: u.email,
            createdAt: null,
            user_metadata: u.user_metadata ?? {},
          });
        }
        if (listed.length === 0) {
          console.debug("[roles] safeListUsers devolvió 0; fillMissing por IDs a continuación.");
        }
      } catch (e) {
        console.debug(
          "[roles] safeListUsers exception:",
          e instanceof Error ? e.message : String(e)
        );
      }

      const allKnownIds = Array.from(
        new Set([...knownIdsFromRoleRows, ...knownIdsFromProfiles])
      );

      const filled = await safeFillMissingUsersById(
        admin,
        allKnownIds,
        new Map<string, SafeFullAuthUser>(
          Array.from(usersMap.entries()).map(([id, v]) => [
            id,
            {
              id,
              email: v.email,
              createdAt: v.createdAt,
              user_metadata:
                v.user_metadata && typeof v.user_metadata === "object"
                  ? (v.user_metadata as Record<string, unknown>)
                  : null,
            },
          ])
        ),
        { label: "roles-fillFrom-user_roles_and_profiles" }
      );

      usersMap.clear();
      for (const [id, u] of filled.entries()) {
        usersMap.set(id, {
          id: u.id,
          email: u.email,
          createdAt: u.createdAt,
          user_metadata: u.user_metadata ?? {},
        });
      }

      const assignedEmails: string[] = [];
      try {
        const q = await admin
          .from("asignaciones")
          .select("assigned_to_email")
          .limit(10000);
        if (!q.error && q.data) {
          const seen = new Set<string>();
          for (const row of q.data as Array<Record<string, unknown>>) {
            const e = normalizeEmail((row as { assigned_to_email?: unknown }).assigned_to_email as string | null | undefined);
            if (e && !seen.has(e)) {
              seen.add(e);
              assignedEmails.push(e);
            }
          }
        }
      } catch (e) {
        console.debug("[roles] asignaciones emails exception:", e instanceof Error ? e.message : String(e));
      }

      const resolvedEmails = new Set<string>();
      for (const u of usersMap.values()) {
        const e = normalizeEmail(u.email);
        if (e) resolvedEmails.add(e);
      }
      const unmatchedAssignedEmails = assignedEmails.filter((e) => !resolvedEmails.has(e));

      const stillMissingIds = allKnownIds.filter((uid) => !usersMap.has(uid));
      if (stillMissingIds.length > 0) {
        let ghostCount = 0;
        let emailIdx = 0;
        const orphanEmailsPool = unmatchedAssignedEmails.slice();
        for (const uid of stillMissingIds) {
          let email = publicEmailByUserId[uid] ?? null;
          if (!email && orphanEmailsPool.length > 0) {
            if (stillMissingIds.length === 1 && orphanEmailsPool.length === 1) {
              email = orphanEmailsPool[0] ?? null;
            } else if (emailIdx < orphanEmailsPool.length) {
              email = orphanEmailsPool[emailIdx] ?? null;
              emailIdx++;
            }
          }
          usersMap.set(uid, {
            id: uid,
            email: email,
            createdAt: null,
            user_metadata: {
              __ghost: true,
              __reason: email ? "orphan-user-email-from-assignations" : "orphan-user-no-email",
              full_name: email
                ? deriveDisplayName(email, {})
                : `Usuario (${uid.slice(0, 8)}...)`,
            },
          });
          ghostCount++;
        }
        if (ghostCount > 0) {
          console.debug(
            `[roles:debug] getUserById completó. Aún faltaban ${stillMissingIds.length} IDs en auth.users.`,
            `Se crearon ${ghostCount} entradas ghost (cuentas huérfanas). unmatched en asignaciones=${unmatchedAssignedEmails.length}.`
          );
        }
      }

      if (usersMap.size > 0) {
        allUsersList = Array.from(usersMap.values());
      }
    }
  } catch (e) {
    console.debug(
      "[roles] Carga de datos async falló (fallback listas vacías):",
      e instanceof Error ? e.message : String(e)
    );
  }

  allUsersList.sort((a, b) => {
    const ea = normalizeEmail(a.email) ?? "";
    const eb = normalizeEmail(b.email) ?? "";
    if (ea && eb) return ea.localeCompare(eb);
    if (ea) return -1;
    if (eb) return 1;
    return a.id.localeCompare(b.id);
  });

  const canEdit = currentRole === "revisor" && haveServiceRole;

  const clientUsers = await Promise.all(
    allUsersList.map(async (u) => {
      const metadata =
        u.user_metadata && typeof u.user_metadata === "object"
          ? (u.user_metadata as Record<string, unknown>)
          : {};
      return {
        id: u.id,
        email: u.email ?? null,
        createdAt: u.createdAt ?? null,
        displayName: deriveDisplayName(u.email ?? null, metadata),
        avatarUrl: admin ? await getSignedAvatarUrl(admin, metadata) : null,
      };
    })
  );

  const rolesShell = sections.length > 0 ? sections : buildSections("revisor");

  return (
    <PlatformShell
      sections={rolesShell}
      currentUserId={user.id}
      currentUserEmail={user.email ?? undefined}
    >
      <div className="mx-auto w-full max-w-[1400px] px-0 md:px-0">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-between gap-3 pt-6">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Roles
              </h1>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Administra el rol de cada usuario autenticado en la plataforma.
              </p>
            </div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              {clientUsers.length} usuarios
            </div>
          </div>

          {!haveServiceRole && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
              Falta configurar <span className="font-medium">SUPABASE_SERVICE_ROLE_KEY</span> en <span className="font-mono">.env.local</span> para administrar roles.
            </div>
          )}

          {!canEdit && haveServiceRole && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
              Solo el rol <span className="font-medium">Revisor</span> puede cambiar roles.
            </div>
          )}

          {(errorParam || messageParam) && (
            <div
              className={[
                "mt-4 rounded-xl border p-4 text-sm",
                errorParam
                  ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100"
                  : "border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-100",
              ].join(" ")}
            >
              {errorParam ?? messageParam}
            </div>
          )}

          <div className="mt-6">
            <RolesTable
              users={clientUsers}
              currentUserId={user.id}
              roleByUserId={roleByUserId}
              roleOptions={roleOptions}
              canEdit={canEdit}
              onUpdate={updateUserRole}
            />
          </div>
        </div>
      </div>
    </PlatformShell>
  );
}
