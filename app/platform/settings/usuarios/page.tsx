import { PlatformShell } from "@/app/platform/platform-shell";
import type { SidebarSection } from "@/app/platform/components/sidebar";
import { createClient } from "@/utils/supabase/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { UsersTable } from "@/app/platform/settings/usuarios/users-table";
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
  makeAdminClientOrNull,
} from "@/lib/safe-auth";

function isNextRedirectError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { digest?: unknown; message?: unknown };
  if (typeof e.digest === "string" && e.digest.startsWith("NEXT_REDIRECT")) return true;
  if (typeof e.message === "string" && e.message.includes("NEXT_REDIRECT")) return true;
  return false;
}

type GotrueErrLike = {
  message?: string;
  code?: string | number | null;
  status?: number | null;
  name?: string | null;
};

function formatGotrueError(e: GotrueErrLike) {
  const rawCode = typeof e.code === "number" ? String(e.code) : (e.code ?? null);
  return {
    msg: typeof e.message === "string" ? e.message : "",
    code: typeof rawCode === "string" ? rawCode : null,
    status: typeof e.status === "number" ? e.status : null,
    name: typeof e.name === "string" ? e.name : null,
  };
}

function mapGotrueErrorMessage(e: GotrueErrLike, emailInvolved: string): string {
  const { msg, code, status } = formatGotrueError(e);

  const m = msg.toLowerCase();
  if (m.includes("database error checking email")) {
    // 2 subtipos distinguibles:
    // A) 401 / 403 / "auth_admin_user" / permiso denegado (Service Role Key errónea o insuficiente)
    // B) 409 / 422 / unique violation (email ya existe, incluso borrado lógico)
    const isPermissionish =
      status === 401 ||
      status === 403 ||
      status === 500 ||
      code === "42501" ||
      code === "42P01" ||
      code === "42883";
    const isDuplicateish =
      status === 409 ||
      status === 422 ||
      code === "23505" ||
      m.includes("duplicate") ||
      m.includes("already exists") ||
      m.includes("unique");

    if (isDuplicateish) {
      return (
        "El correo '" +
        emailInvolved +
        "' ya está registrado (pudo haber quedado borrado lógico en auth.users.deleted_at). Si lo eliminaste recientemente, purga la fila con SQL: DELETE FROM auth.users WHERE email = '" +
        emailInvolved +
        "'; antes de volver a crearlo."
      );
    }
    if (isPermissionish) {
      return (
        "No tienes permisos de admin en Supabase Auth. Verifica en Project Settings → API que la variable SUPABASE_SERVICE_ROLE_KEY de .env.local sea la key 'service_role' (no la anon, no la public). Luego reinicia: npm run dev:local. Si la key es correcta, puede que el correo '" +
        emailInvolved +
        "' ya exista; prueba en SQL Editor: SELECT id, email, deleted_at FROM auth.users WHERE email = '" +
        emailInvolved +
        "';"
      );
    }

    // Caso sin código: combinamos ambas pistas
    return (
      "No se pudo crear el usuario. Posibles causas: (1) SUPABASE_SERVICE_ROLE_KEY no es correcta o no tiene permisos de admin; (2) el correo '" +
      emailInvolved +
      "' ya está registrado en auth.users (pudo quedar con deleted_at). Cómo confirmarlo: abre SQL Editor en Supabase y corre — SELECT id, email, deleted_at FROM auth.users WHERE email = '" +
      emailInvolved +
      "'; — Si devuelve 1 fila y quieres recrearlo, borra la fila: DELETE FROM auth.users WHERE email = '" +
      emailInvolved +
      "'; — Si devuelve 0 filas, entonces tu SERVICE_ROLE_KEY es incorrecta; compruébala en Project Settings → API."
    );
  }
  if (code === "23505" || m.includes("unique") || m.includes("duplicate") || m.includes("already registered")) {
    return "El correo '" + emailInvolved + "' ya está registrado en el sistema.";
  }
  if (m.includes("password") && (m.includes("length") || m.includes("weak") || m.includes("too short") || m.includes("invalid"))) {
    return "La contraseña no cumple con las reglas de fortaleza de Supabase Auth. Usa al menos 6 caracteres.";
  }
  if (m.includes("invalid email") || m.includes("email address") || m.includes("email format")) {
    return "El formato del correo no es válido: '" + emailInvolved + "'.";
  }
  if (code === "42501" || m.includes("permission") || m.includes("denied")) {
    return "Falta permiso para crear usuarios. Confirma que SUPABASE_SERVICE_ROLE_KEY es la key 'service_role' (no la anon key).";
  }
  return msg || "No se pudo crear el usuario.";
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type RoleRowClient = {
  userId: string;
  roleCode: string | null;
  roleLabel: string;
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

export default async function UsuariosPage({
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
      console.debug("[usuarios] getUser error:", resp.error.message);
    }
  } catch (e) {
    console.debug(
      "[usuarios] getUser exception:",
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
        console.debug("[usuarios] strongCheck lanzó NEXT_REDIRECT, no re-lanzamos.");
      } else if (digest.startsWith("NEXT_NOTFOUND")) {
        console.debug("[usuarios] strongCheck lanzó NEXT_NOTFOUND, no re-lanzamos.");
      }
    } else {
      console.debug(
        "[usuarios] strongCheck exception:",
        e instanceof Error ? e.message : String(e)
      );
    }
    currentRole = "usuario";
    sections = buildSections("revisor");
  }

  const sp = await searchParams;
  const errorParam = getSearchParam(sp, "error");
  const messageParam = getSearchParam(sp, "message");

  let allUsersList: Array<{
    id: string;
    email: string | null;
    createdAt: string | null;
    user_metadata: unknown;
  }> = [];
  const rolesRowsClient: RoleRowClient[] = [];

  const haveServiceRole = Boolean(
    serviceKey && !serviceKey.includes("__REPLACE_ME__")
  );
  let admin: ReturnType<typeof createSupabaseAdminClient> | null = null;
  if (haveServiceRole && serviceKey) {
    admin = createSupabaseAdminClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async function deleteUser(formData: FormData): Promise<{ ok: boolean; url: string }> {
    "use server";

    const srvUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const srvAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const srvService = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const baseUrl = "/platform/settings/usuarios";

    if (
      !srvUrl ||
      !srvAnon ||
      srvUrl.includes("__REPLACE_ME__") ||
      srvAnon.includes("__REPLACE_ME__")
    ) {
      return { ok: false, url: baseUrl + "?error=" + encodeURIComponent("Configura Supabase primero (env vars).") };
    }

    if (!srvService || srvService.includes("__REPLACE_ME__")) {
      return {
        ok: false,
        url: baseUrl + "?error=" + encodeURIComponent("Falta SUPABASE_SERVICE_ROLE_KEY para eliminar usuarios."),
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
        url: baseUrl + "?error=" + encodeURIComponent("No tienes permisos para eliminar usuarios."),
      };
    }

    const targetUserId = String(formData.get("user_id") ?? "");
    if (!targetUserId) {
      return {
        ok: false,
        url: baseUrl + "?error=" + encodeURIComponent("Falta user_id."),
      };
    }

    if (targetUserId === callerUser.id) {
      return {
        ok: false,
        url: baseUrl + "?error=" + encodeURIComponent("No puedes eliminar tu propio usuario."),
      };
    }

    const srvAdmin = createSupabaseAdminClient(srvUrl, srvService, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    try {
      await srvAdmin.from("user_roles").delete().eq("user_id", targetUserId);
    } catch (e) {
      console.debug(
        "[usuarios] delete user_roles warning (continuamos):",
        e instanceof Error ? e.message : String(e)
      );
    }

    try {
      const { error } = await srvAdmin.auth.admin.deleteUser(targetUserId);
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
      url: baseUrl + "?message=" + encodeURIComponent("El usuario se eliminó exitosamente."),
    };
  }

  async function updateUser(formData: FormData): Promise<{ ok: boolean; url: string }> {
    "use server";

    const srvUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const srvAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const srvService = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const baseUrl = "/platform/settings/usuarios";

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
        url: baseUrl + "?error=" + encodeURIComponent("Falta SUPABASE_SERVICE_ROLE_KEY para editar usuarios."),
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
        url: baseUrl + "?error=" + encodeURIComponent("No tienes permisos para editar usuarios."),
      };
    }

    const targetUserId = String(formData.get("user_id") ?? "");
    const nombre = String(formData.get("nombre") ?? "").trim();
    const correo = String(formData.get("correo") ?? "").trim().toLowerCase();
    const contrasena = String(formData.get("contrasena") ?? "");
    const rawRoleCode = formData.get("role_code");

    if (!targetUserId) {
      return {
        ok: false,
        url: baseUrl + "?error=" + encodeURIComponent("Falta user_id."),
      };
    }

    if (!nombre) {
      return {
        ok: false,
        url: baseUrl + "?error=" + encodeURIComponent("El nombre es obligatorio."),
      };
    }

    if (!correo || !correo.includes("@")) {
      return {
        ok: false,
        url: baseUrl + "?error=" + encodeURIComponent("El correo es obligatorio y debe ser válido."),
      };
    }

    if (contrasena && contrasena.length < 6) {
      return {
        ok: false,
        url: baseUrl + "?error=" + encodeURIComponent("La contraseña debe tener al menos 6 caracteres."),
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
      const updatePayload: {
        email: string;
        password?: string;
        email_confirm?: boolean;
        user_metadata: { full_name: string; display_name: string; name: string };
      } = {
        email: correo,
        email_confirm: true,
        user_metadata: { full_name: nombre, display_name: nombre, name: nombre },
      };
      if (contrasena && contrasena.length >= 6) {
        updatePayload.password = contrasena;
      }
      const { error } = await srvAdmin.auth.admin.updateUserById(
        targetUserId,
        updatePayload
      );
      if (error) {
        const fe = formatGotrueError(error);
        console.debug("[usuarios:updateUser] createError detallado:", {
          message: fe.msg,
          code: fe.code,
          status: fe.status,
          name: fe.name,
          correo,
          targetUserId,
        });
        const human = mapGotrueErrorMessage(error, correo);
        return {
          ok: false,
          url: baseUrl + "?error=" + encodeURIComponent(human),
        };
      }
    } catch (e) {
      if (isNextRedirectError(e)) throw e;
      const err =
        e && typeof e === "object" && ("message" in e || "code" in e)
          ? (e as GotrueErrLike)
          : { message: e instanceof Error ? e.message : String(e) };
      const fe = formatGotrueError(err);
      console.debug("[usuarios:updateUser] exception:", {
        message: fe.msg,
        code: fe.code,
        status: fe.status,
        name: fe.name,
        correo,
        targetUserId,
      });
      const human = mapGotrueErrorMessage(err, correo);
      return {
        ok: false,
        url: baseUrl + "?error=" + encodeURIComponent(human),
      };
    }

    try {
      const { error: roleError } = await srvAdmin
        .from("user_roles")
        .upsert(
          { user_id: targetUserId, role_code: roleCodeNumeric },
          { onConflict: "user_id" }
        );

      if (roleError) {
        return {
          ok: false,
          url: baseUrl + "?error=" + encodeURIComponent(roleError.message),
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
      url: baseUrl + "?message=" + encodeURIComponent("El usuario se actualizó exitosamente."),
    };
  }

  async function createUser(formData: FormData): Promise<{ ok: boolean; url: string }> {
    "use server";

    const srvUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const srvAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const srvService = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const baseUrl = "/platform/settings/usuarios";

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
        url: baseUrl + "?error=" + encodeURIComponent("Falta SUPABASE_SERVICE_ROLE_KEY para crear usuarios."),
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
        url: baseUrl + "?error=" + encodeURIComponent("No tienes permisos para crear usuarios."),
      };
    }

    const nombre = String(formData.get("nombre") ?? "").trim();
    const correo = String(formData.get("correo") ?? "").trim().toLowerCase();
    const contrasena = String(formData.get("contrasena") ?? "");
    const rawRoleCode = formData.get("role_code");

    if (!nombre) {
      return {
        ok: false,
        url: baseUrl + "?error=" + encodeURIComponent("El nombre es obligatorio."),
      };
    }

    if (!correo || !correo.includes("@")) {
      return {
        ok: false,
        url: baseUrl + "?error=" + encodeURIComponent("El correo es obligatorio y debe ser válido."),
      };
    }

    if (!contrasena || contrasena.length < 6) {
      return {
        ok: false,
        url: baseUrl + "?error=" + encodeURIComponent("La contraseña es obligatoria y debe tener al menos 6 caracteres."),
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

    // PRE-CHECK: correo duplicado (tanto en auth.users real como en entradas ghost huérfanas)
    let emailYaExiste = false;
    try {
      const adminForCheck = makeAdminClientOrNull();
      if (adminForCheck) {
        const rolesQ = await srvAdmin
          .from("user_roles")
          .select("user_id")
          .limit(5000);
        if (!rolesQ.error && Array.isArray(rolesQ.data)) {
          const ids: string[] = rolesQ.data
            .map((r) => (r as { user_id?: string | null }).user_id)
            .filter((x): x is string => typeof x === "string" && x.length > 0);
          if (ids.length > 0) {
            const resolved = await safeFillMissingUsersById(adminForCheck, ids);
            for (const u of Object.values(resolved)) {
              if (u?.email && u.email.toLowerCase() === correo) {
                emailYaExiste = true;
                break;
              }
            }
          }
        } else if (rolesQ.error) {
          console.debug("[usuarios:createUser] pre-check roles error:", rolesQ.error.message);
        }

        if (!emailYaExiste) {
          const emailsFromAsignaciones = new Set<string>();
          try {
            const q = await srvAdmin
              .from("asignaciones")
              .select("assigned_to_email")
              .limit(5000);
            if (!q.error && Array.isArray(q.data)) {
              for (const r of q.data) {
                const rr = r as { assigned_to_email?: string | null };
                if (rr.assigned_to_email) emailsFromAsignaciones.add(rr.assigned_to_email.toLowerCase());
              }
            }
          } catch {
            /* ignore */
          }
          if (emailsFromAsignaciones.has(correo)) {
            // Aviso suave: ya tiene asignaciones, pero no es bloqueante.
          }
        }
      }
    } catch (e) {
      console.debug("[usuarios:createUser] pre-check exception:", e instanceof Error ? e.message : String(e));
    }

    if (emailYaExiste) {
      return {
        ok: false,
        url:
          baseUrl +
          "?error=" +
          encodeURIComponent("El correo '" + correo + "' ya está registrado."),
      };
    }

    let createdUserId: string | null = null;
    try {
      const { data: created, error: createError } = await srvAdmin.auth.admin.createUser({
        email: correo,
        password: contrasena,
        email_confirm: true,
        user_metadata: { full_name: nombre, display_name: nombre, name: nombre },
      });

      if (createError || !created?.user) {
        const fe = formatGotrueError(createError ?? {});
        console.debug("[usuarios:createUser] createError detallado:", {
          message: fe.msg,
          code: fe.code,
          status: fe.status,
          name: fe.name,
          correo,
        });
        const human = mapGotrueErrorMessage(createError ?? {}, correo);
        return {
          ok: false,
          url: baseUrl + "?error=" + encodeURIComponent(human),
        };
      }
      createdUserId = created.user.id;
    } catch (e) {
      if (isNextRedirectError(e)) throw e;
      const err =
        e && typeof e === "object" && ("message" in e || "code" in e)
          ? (e as GotrueErrLike)
          : { message: e instanceof Error ? e.message : String(e) };
      const fe = formatGotrueError(err);
      console.debug("[usuarios:createUser] exception:", {
        message: fe.msg,
        code: fe.code,
        status: fe.status,
        name: fe.name,
        correo,
      });
      const human = mapGotrueErrorMessage(err, correo);
      return {
        ok: false,
        url: baseUrl + "?error=" + encodeURIComponent(human),
      };
    }

    try {
      const { error: roleError } = await srvAdmin
        .from("user_roles")
        .upsert(
          { user_id: createdUserId, role_code: roleCodeNumeric },
          { onConflict: "user_id" }
        );

      if (roleError) {
        return {
          ok: false,
          url: baseUrl + "?error=" + encodeURIComponent(roleError.message),
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
      url: baseUrl + "?message=" + encodeURIComponent("El usuario se creó exitosamente."),
    };
  }

  try {
    if (admin) {
      const knownIdsFromRoleRows: string[] = [];
      try {
        const q = await admin.from("user_roles").select("user_id, role_code").limit(5000);
        if (!q.error && q.data) {
          for (const row of q.data) {
            const r = row as Record<string, unknown>;
            const uid = typeof r.user_id === "string" && r.user_id ? r.user_id : null;
            if (uid) knownIdsFromRoleRows.push(uid);
            const canonicalKey = resolveCanonicalRoleFromUnknown(r.role_code);
            if (uid) {
              if (canonicalKey && canonicalKey in DEFAULT_ROLE_LABELS) {
                rolesRowsClient.push({
                  userId: uid,
                  roleCode: canonicalKey,
                  roleLabel: DEFAULT_ROLE_LABELS[canonicalKey as DefaultRoleCode],
                });
              } else {
                const rawCode =
                  typeof r.role_code === "number"
                    ? String(r.role_code)
                    : typeof r.role_code === "string" && r.role_code.trim()
                      ? r.role_code.trim()
                      : null;
                rolesRowsClient.push({
                  userId: uid,
                  roleCode: rawCode,
                  roleLabel: rawCode ? (rawCode === "1" || rawCode === "revisor" ? "Revisor" : rawCode === "2" || rawCode === "supervisor" ? "Supervisor" : rawCode) : "Sin asignar",
                });
              }
            }
          }
        } else if (q.error && !isSchemaMismatchPostgres(q.error)) {
          console.debug("[usuarios] user_roles error:", q.error.message);
        }
      } catch (e) {
        console.debug(
          "[usuarios] user_roles exception:",
          e instanceof Error ? e.message : String(e)
        );
      }

      const usersMap = new Map<
        string,
        { id: string; email: string | null; createdAt: string | null; user_metadata: unknown }
      >();

      try {
        const listed = await safeListUsers({ perPage: 500, page: 1, label: "usuarios-listUsers" });
        for (const u of listed) {
          usersMap.set(u.id, {
            id: u.id,
            email: u.email,
            createdAt: null,
            user_metadata: u.user_metadata ?? {},
          });
        }
        if (listed.length === 0) {
          console.debug("[usuarios] safeListUsers devolvió 0; usaremos fillMissing por IDs.");
        }
      } catch (e) {
        console.debug(
          "[usuarios] safeListUsers exception:",
          e instanceof Error ? e.message : String(e)
        );
      }

      const allKnownIds = Array.from(new Set(knownIdsFromRoleRows));
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
        { label: "usuarios-fillFrom-user_roles" }
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

      if (usersMap.size < allKnownIds.length) {
        const stillMissingIds = allKnownIds.filter((id) => !usersMap.has(id));
        console.debug(
          `[usuarios:debug] fillMissing completado. Quedan ${stillMissingIds.length} IDs sin registro auth.users (se crearán ghost desde asignaciones).`,
          stillMissingIds.slice(0, 10)
        );

        const assignedEmails: string[] = [];
        try {
          const q = await admin
            .from("asignaciones")
            .select("assigned_to_email")
            .limit(10000);
          if (!q.error && q.data) {
            const seen = new Set<string>();
            for (const row of q.data as Array<Record<string, unknown>>) {
              const e = normalizeEmail(
                (row as { assigned_to_email?: unknown }).assigned_to_email as
                  | string
                  | null
                  | undefined
              );
              if (e && !seen.has(e)) {
                seen.add(e);
                assignedEmails.push(e);
              }
            }
          }
        } catch (e) {
          console.debug(
            "[usuarios] asignaciones emails exception:",
            e instanceof Error ? e.message : String(e)
          );
        }

        const resolvedEmails = new Set<string>();
        for (const u of usersMap.values()) {
          const e = normalizeEmail(u.email);
          if (e) resolvedEmails.add(e);
        }
        const unmatchedAssignedEmails = assignedEmails.filter(
          (e) => !resolvedEmails.has(e)
        );

        if (stillMissingIds.length > 0) {
          let ghostCount = 0;
          let emailIdx = 0;
          const orphanEmailsPool = unmatchedAssignedEmails.slice();
          for (const uid of stillMissingIds) {
            let email: string | null = null;
            if (orphanEmailsPool.length > 0) {
              if (
                stillMissingIds.length === 1 &&
                orphanEmailsPool.length === 1
              ) {
                email = orphanEmailsPool[0] ?? null;
              } else if (emailIdx < orphanEmailsPool.length) {
                email = orphanEmailsPool[emailIdx] ?? null;
                emailIdx++;
              }
            }
            usersMap.set(uid, {
              id: uid,
              email,
              createdAt: null,
              user_metadata: {
                __ghost: true,
                __reason: email
                  ? "orphan-user-email-from-assignations"
                  : "orphan-user-no-email",
                full_name: email
                  ? deriveDisplayName(email, {})
                  : `Usuario (${uid.slice(0, 8)}...)`,
              },
            });
            ghostCount++;
          }
          if (ghostCount > 0) {
            console.debug(
              `[usuarios:debug] Se crearon ${ghostCount} entradas ghost. unmatched en asignaciones=${unmatchedAssignedEmails.length}.`
            );
          }
        }
      }

      if (usersMap.size > 0) {
        allUsersList = Array.from(usersMap.values());
      }
    }
  } catch (e) {
    console.debug(
      "[usuarios] Carga de datos async falló (fallback listas vacías):",
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
                Usuarios
              </h1>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Administra los usuarios autenticados y crea nuevas cuentas.
              </p>
            </div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              {clientUsers.length} usuarios
            </div>
          </div>

          {!haveServiceRole && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
              Falta configurar <span className="font-medium">SUPABASE_SERVICE_ROLE_KEY</span> en <span className="font-mono">.env.local</span> para administrar usuarios.
            </div>
          )}

          {!canEdit && haveServiceRole && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
              Solo el rol <span className="font-medium">Revisor</span> puede crear o eliminar usuarios.
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
            <UsersTable
              users={clientUsers}
              roles={rolesRowsClient}
              currentUserId={user.id}
              canEdit={canEdit}
              onDelete={deleteUser}
              onCreate={createUser}
              onUpdate={updateUser}
            />
          </div>
        </div>
      </div>
    </PlatformShell>
  );
}
