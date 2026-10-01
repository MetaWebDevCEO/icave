import type { SupabaseClient } from "@supabase/supabase-js";
import type { SidebarSection } from "@/app/platform/components/sidebar";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { safeQuerySelect, makeAdminClientOrNull } from "@/lib/safe-auth";

export type UserRole = "revisor" | "usuario";

export function isUserRole(value: unknown): value is UserRole {
  return value === "revisor" || value === "usuario";
}

export function normalizeRole(value: unknown): UserRole | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return isUserRole(normalized) ? normalized : null;
}

export function normalizeRoleCode(value: unknown): UserRole | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    if (value === 1) return "revisor";
    if (value === 2) return "usuario";
    return null;
  }

  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return null;

  if (isUserRole(normalized)) return normalized;

  if (normalized === "reviewer" || normalized === "rev" || normalized === "r") {
    return "revisor";
  }
  if (normalized === "admin" || normalized === "administrador") {
    return "usuario";
  }
  if (normalized === "sup" || normalized === "s") {
    return "usuario";
  }

  // Números como texto: '1' '2' etc.
  if (normalized === "1") return "revisor";
  if (normalized === "2") return "usuario";

  if (normalized.includes("usuario")) return "usuario";
  if (normalized.includes("super")) return "usuario";
  if (normalized.includes("revi")) return "revisor";
  if (normalized.includes("admin")) return "usuario";

  return null;
}

export async function getRoleFromUserRolesTable(
  supabase: SupabaseClient,
  userId: string
): Promise<UserRole> {
  const DEFAULT_ROLE: UserRole = "usuario";

  const { data, error } = await supabase
    .from("user_roles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn(
      "[platform-roles] Error al consultar user_roles:",
      error.message,
      ". Usando rol por defecto:",
      DEFAULT_ROLE
    );
    return DEFAULT_ROLE;
  }

  if (!data) {
    console.warn(
      "[platform-roles] No existe fila en user_roles para userId=",
      userId,
      ". Usando rol por defecto:",
      DEFAULT_ROLE
    );
    return DEFAULT_ROLE;
  }

  const record = data as Record<string, unknown>;
  const role =
    normalizeRole(record.role) ??
    normalizeRole(record.rol) ??
    normalizeRole(record.user_role) ??
    normalizeRole(record.tipo) ??
    normalizeRole(record.type) ??
    normalizeRoleCode(record.role_code);

  if (!role) {
    const keys = Object.keys(record);
    console.warn(
      "[platform-roles] No se detectó columna de rol válida. Columnas:",
      keys,
      "Contenido:",
      JSON.stringify(record),
      ". Usando rol por defecto:",
      DEFAULT_ROLE
    );
    return DEFAULT_ROLE;
  }

  return role;
}

export const REVISOR_ROUTES = {
  dashboard: "/platform/revisor",
  asignacion: "/platform/revisor/asignacion",
  supervisores: "/platform/revisor/supervisores",
  task: "/platform/task",
  chat: "/platform/chat",
  correos: "/platform/correos",
  documentos: "/platform/documentos",
  planificador: "/platform/planificador",
  roles: "/platform/settings/roles",
  usuarios: "/platform/settings/usuarios",
  notificacion: "/platform/settings/notificacion",
  notificaciones: "/platform/settings/notificaciones",
} as const;

export const SUPERVISOR_ROUTES = {
  dashboard: "/platform/supervisor",
  rendimiento: "/platform/supervisor",
  supervisores: "/platform/revisor/supervisores",
  status: "/platform/supervisor/status",
  bandeja: "/platform/supervisor/bandeja",
  task: "/platform/task",
  chat: "/platform/chat",
  correos: "/platform/correos",
  documentos: "/platform/documentos",
  planificador: "/platform/planificador",
  notificaciones: "/platform/settings/notificaciones",
  configuracion: "/platform/configuracion",
} as const;

export function buildRevisorSections(): SidebarSection[] {
  return [
    {
      title: "Plataforma (Revisor)",
      items: [
        { title: "Dashboard", href: REVISOR_ROUTES.dashboard },
        { title: "Asignacion", href: REVISOR_ROUTES.asignacion },
        { title: "Supervisores", href: REVISOR_ROUTES.supervisores },
        { title: "Task", href: REVISOR_ROUTES.task },
      ],
    },
    {
      title: "Herramientas",
      items: [
        { title: "Chat Directo", href: REVISOR_ROUTES.chat },
        { title: "Correos", href: REVISOR_ROUTES.correos },
        { title: "Archivero", href: REVISOR_ROUTES.documentos },
        { title: "Planificador", href: REVISOR_ROUTES.planificador },
      ],
    },
    {
      title: "Setting",
      items: [
        { title: "Roles", href: REVISOR_ROUTES.roles },
        { title: "Usuarios", href: REVISOR_ROUTES.usuarios },
        { title: "Notificacion", href: REVISOR_ROUTES.notificacion },
      ],
    },
  ];
}

export function buildSupervisorSections(): SidebarSection[] {
  return [
    {
      title: "Plataforma (Supervisor)",
      items: [
        { title: "Mi Rendimiento", href: SUPERVISOR_ROUTES.dashboard },
        { title: "Supervisores", href: SUPERVISOR_ROUTES.supervisores },
        { title: "Status", href: SUPERVISOR_ROUTES.status },
        { title: "Bandeja de Entrada", href: SUPERVISOR_ROUTES.bandeja },
        { title: "Task", href: SUPERVISOR_ROUTES.task },
      ],
    },
    {
      title: "Herramientas",
      items: [
        { title: "Chat Directo", href: SUPERVISOR_ROUTES.chat },
        { title: "Correos", href: SUPERVISOR_ROUTES.correos },
        { title: "Archivero", href: SUPERVISOR_ROUTES.documentos },
        { title: "Planificador", href: SUPERVISOR_ROUTES.planificador },
      ],
    },
    {
      title: "Setting",
      items: [
        { title: "Notificaciones", href: SUPERVISOR_ROUTES.notificaciones },
        { title: "Configuracion", href: SUPERVISOR_ROUTES.configuracion },
      ],
    },
  ];
}

export function buildSections(role: UserRole): SidebarSection[] {
  return role === "revisor" ? buildRevisorSections() : buildSupervisorSections();
}

export function dashboardForRole(role: UserRole): string {
  return role === "revisor" ? REVISOR_ROUTES.dashboard : SUPERVISOR_ROUTES.dashboard;
}

function resolveRoleFromRow(record: Record<string, unknown>): UserRole | null {
  return (
    normalizeRole(record.role) ??
    normalizeRole(record.rol) ??
    normalizeRole(record.user_role) ??
    normalizeRole(record.tipo) ??
    normalizeRole(record.type) ??
    normalizeRoleCode(record.role_code)
  );
}

export async function resolveRoleForUser(
  supabase: SupabaseClient,
  userId: string,
  opts: { email?: string | null } = {}
): Promise<UserRole> {
  const DEFAULT_ROLE: UserRole = "usuario";

  const uidLow = (userId ?? "").trim().toLowerCase();
  const emailLow =
    typeof opts.email === "string"
      ? opts.email.trim().toLowerCase()
      : null;

  const lookupSingleEq = async (client: SupabaseClient): Promise<UserRole | null> => {
    try {
      const { data, error } = await client
        .from("user_roles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (error || !data) return null;
      return resolveRoleFromRow(data as Record<string, unknown>);
    } catch {
      return null;
    }
  };

  const lookupViaUserRolesFullScan = async (client: SupabaseClient): Promise<UserRole | null> => {
    try {
      const q = await safeQuerySelect<Record<string, unknown>[]>(
        async (c) =>
          await c
            .from("user_roles")
            .select("user_id, role_code, role, rol, user_role, type, tipo, email, created_at, updated_at")
            .limit(5000),
        {
          retries: 3,
          label: "resolveRoleForUser-userRoles-scan",
          primaryClient: client,
          defaultData: [],
        }
      );
      const rows = q.data ?? [];
      for (const r of rows) {
        const rUid =
          typeof r.user_id === "string" ? r.user_id.trim().toLowerCase() : "";
        const rEmail =
          typeof r.email === "string" ? r.email.trim().toLowerCase() : "";
        const matchByUid = !!rUid && rUid === uidLow;
        const matchByEmail =
          !!emailLow && !!rEmail && rEmail === emailLow;
        if (matchByUid || matchByEmail) {
          const found = resolveRoleFromRow(r);
          if (found) return found;
        }
      }
      return null;
    } catch {
      return null;
    }
  };

  const lookupViaProfiles = async (client: SupabaseClient): Promise<UserRole | null> => {
    try {
      const q = await safeQuerySelect<Record<string, unknown>[]>(
        async (c) =>
          await c
            .from("profiles")
            .select("id, email, role, rol, role_code, user_role, type, tipo, updated_at")
            .limit(5000),
        {
          retries: 2,
          label: "resolveRoleForUser-profiles-scan",
          primaryClient: client,
          defaultData: [],
        }
      );
      const rows = q.data ?? [];
      for (const r of rows) {
        const rUid =
          typeof r.id === "string" ? r.id.trim().toLowerCase() : "";
        const rEmail =
          typeof r.email === "string" ? r.email.trim().toLowerCase() : "";
        const matchByUid = !!rUid && rUid === uidLow;
        const matchByEmail =
          !!emailLow && !!rEmail && rEmail === emailLow;
        if (!matchByUid && !matchByEmail) continue;
        const found = resolveRoleFromRow(r);
        if (found) return found;
      }
    } catch {
      /* ignore */
    }
    return null;
  };

  // ====== Strategy 1: single .eq() con el client que pasó el caller ======
  let r = await lookupSingleEq(supabase);
  if (r) return r;

  // ====== Strategy 2: full scan user_roles con el mismo client (casos user_id con UUID mixto, RLS por columna rara, etc) ======
  r = await lookupViaUserRolesFullScan(supabase);
  if (r) return r;

  // ====== Strategy 3: profiles ======
  r = await lookupViaProfiles(supabase);
  if (r) return r;

  // ====== Strategy 4: repetir 1/2/3 con admin client ======
  const admin = makeAdminClientOrNull();
  if (admin) {
    r = await lookupSingleEq(admin);
    if (r) return r;
    r = await lookupViaUserRolesFullScan(admin);
    if (r) return r;
    r = await lookupViaProfiles(admin);
    if (r) return r;
  }

  // ====== Strategy 5 (heurística defensiva): si el email del usuario está en
  // la misma lista que otra fila que SÍ es revisor, no concluir nada;
  // pero si NO hay ninguna fila en user_roles que sea revisor y el usuario
  // es el único autenticado, NO marcar DEFAULT_ROLE=usuario si la tabla roles
  // catálogo indica que 'revisor' existe y tiene 1 sola asignación. ======
  try {
    const rolesQ = await safeQuerySelect<Record<string, unknown>[]>(
      async (c) => await c.from("roles").select("id, code, name").limit(50),
      {
        retries: 2,
        label: "resolveRoleForUser-catalog-roles",
        primaryClient: admin ?? undefined,
        fallbackClient: supabase,
        defaultData: [],
      }
    );
    const hasRevisorCatalog = (rolesQ.data ?? []).some((catRow) => {
      const name = typeof catRow.name === "string" ? catRow.name.trim().toLowerCase() : "";
      const code = typeof catRow.code === "string" ? catRow.code.trim() : String(catRow.code ?? "");
      const id = typeof catRow.id === "number" ? catRow.id : typeof catRow.id === "string" ? Number(catRow.id) : NaN;
      return name === "revisor" || code === "1" || id === 1 || name === "reviewer";
    });

    if (hasRevisorCatalog) {
      // Si el catalogo admite revisores PERO el usuario no tiene fila,
      // NO asumir "usuario" a ciegas: darle tratamiento de "revisor" solo si
      // el correo termina en dominio del equipo. Fallback seguro: se queda en
      // DEFAULT_ROLE, pero dejamos rastro en consola.
      // (En este punto no redirijo, el caller lo hará.)
    }
  } catch {
    /* ignore */
  }

  console.warn(
    "[platform-roles] No se pudo determinar el rol para userId=",
    userId,
    emailLow ? ` email=${emailLow}` : "",
    ". Se usa rol por defecto:",
    DEFAULT_ROLE,
    ". Verifica que exista la fila en public.user_roles (user_id UUID igual que auth.users.id) y RLS permita SELECT."
  );
  return DEFAULT_ROLE;
}

/**
 * Check de última instancia: "¿realmente es revisor?"
 * Úsalo antes de `if (role !== "revisor") redirect(...)` para evitar expulsar
 * usuarios revisores cuando resolveRoleForUser cayó en DEFAULT_ROLE por
 * cache de schema, UUID minúsculas/mayúsculas o filtro RLS transitorio.
 */
export async function strongCheckIsRevisor(
  supabase: SupabaseClient,
  userId: string,
  opts: { email?: string | null } = {}
): Promise<{ isRevisor: boolean; decidedRole: UserRole; reason: string }> {
  let decidedRole: UserRole = await resolveRoleForUser(supabase, userId, opts);
  let isRevisor: boolean = decidedRole === "revisor";
  if (isRevisor) {
    return { isRevisor: true, decidedRole, reason: "resolveRoleForUser" };
  }

  const uidLow = (userId ?? "").trim().toLowerCase();
  const emailLow =
    typeof opts.email === "string"
      ? opts.email.trim().toLowerCase()
      : null;
  const admin = makeAdminClientOrNull();
  const clients: SupabaseClient[] = [supabase];
  if (admin && admin !== (supabase as unknown)) clients.push(admin);

  for (const client of clients) {
    try {
      const q = await safeQuerySelect<Record<string, unknown>[]>(
        async (c) =>
          await c
            .from("user_roles")
            .select("user_id, email, role_code, role, rol, user_role, type, tipo")
            .limit(5000),
        {
          retries: 2,
          label: "strongCheckIsRevisor",
          primaryClient: client,
          defaultData: [],
        }
      );
      for (const r of q.data ?? []) {
        const rUid = typeof r.user_id === "string" ? r.user_id.trim().toLowerCase() : "";
        const rEmail = typeof r.email === "string" ? r.email.trim().toLowerCase() : "";
        const matchUid = !!rUid && rUid === uidLow;
        const matchEmail = !!emailLow && !!rEmail && rEmail === emailLow;
        if (!matchUid && !matchEmail) continue;
        const resolved = resolveRoleFromRow(r);
        if (resolved === "revisor") {
          return { isRevisor: true, decidedRole: "revisor", reason: "strongCheck: user_roles full scan" };
        }
        if (resolved === "usuario") {
          return { isRevisor: false, decidedRole: "usuario", reason: "strongCheck: user_roles full scan" };
        }
      }
    } catch {
      /* ignore */
    }

    try {
      const q = await safeQuerySelect<Record<string, unknown>[]>(
        async (c) =>
          await c
            .from("profiles")
            .select("id, email, role_code, role, rol, user_role, type, tipo")
            .limit(5000),
        {
          retries: 2,
          label: "strongCheckIsRevisor-profiles",
          primaryClient: client,
          defaultData: [],
        }
      );
      for (const r of q.data ?? []) {
        const rUid = typeof r.id === "string" ? r.id.trim().toLowerCase() : "";
        const rEmail = typeof r.email === "string" ? r.email.trim().toLowerCase() : "";
        const matchUid = !!rUid && rUid === uidLow;
        const matchEmail = !!emailLow && !!rEmail && rEmail === emailLow;
        if (!matchUid && !matchEmail) continue;
        const resolved = resolveRoleFromRow(r);
        if (resolved === "revisor") {
          return { isRevisor: true, decidedRole: "revisor", reason: "strongCheck: profiles full scan" };
        }
      }
    } catch {
      /* ignore */
    }
  }

  return {
    isRevisor,
    decidedRole,
    reason: isRevisor ? "resolveRoleForUser" : "no match (default usuario)",
  };
}

