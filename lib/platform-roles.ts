import type { SupabaseClient } from "@supabase/supabase-js";
import type { SidebarSection } from "@/app/platform/components/sidebar";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";

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
  task: "/platform/revisor/task",
  chat: "/platform/chat",
  correos: "/platform/correos",
  documentos: "/platform/documentos",
  planificador: "/platform/planificador",
  roles: "/platform/revisor/settings/roles",
  usuarios: "/platform/revisor/settings/usuarios",
  notificacion: "/platform/settings/notificacion",
  notificaciones: "/platform/settings/notificaciones",
} as const;

export const SUPERVISOR_ROUTES = {
  dashboard: "/platform/supervisor",
  rendimiento: "/platform/supervisor",
  status: "/platform/supervisor/status",
  bandeja: "/platform/supervisor/bandeja",
  task: "/platform/supervisor/task",
  chat: "/platform/chat",
  correos: "/platform/correos",
  documentos: "/platform/documentos",
  planificador: "/platform/planificador",
  notificaciones: "/platform/settings/notificaciones",
  configuracion: "/platform/supervisor/configuracion",
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
        { title: "Documentos", href: REVISOR_ROUTES.documentos },
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
        { title: "Documentos", href: SUPERVISOR_ROUTES.documentos },
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

function makeAdminClientOrNull(): SupabaseClient | null {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey || url.includes("__REPLACE_ME__") || serviceKey.includes("__REPLACE_ME__")) {
      return null;
    }
    return createSupabaseAdminClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch {
    return null;
  }
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
  userId: string
): Promise<UserRole> {
  const DEFAULT_ROLE: UserRole = "usuario";

  const lookupWithClient = async (client: SupabaseClient): Promise<UserRole | null> => {
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

  const first = await lookupWithClient(supabase);
  if (first) return first;

  const admin = makeAdminClientOrNull();
  if (admin) {
    const second = await lookupWithClient(admin);
    if (second) return second;
  }

  console.warn(
    "[platform-roles] No se pudo determinar el rol para userId=",
    userId,
    ". Se usa rol por defecto:",
    DEFAULT_ROLE,
    ". Verifica que exista la fila en public.user_roles."
  );
  return DEFAULT_ROLE;
}

