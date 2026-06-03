import { PlatformShell } from "@/app/platform/platform-shell";
import type { SidebarSection } from "@/app/platform/components/sidebar";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

type UserRole = "revisor" | "usuario";

function isUserRole(value: unknown): value is UserRole {
  return value === "revisor" || value === "usuario";
}

function normalizeRole(value: unknown): UserRole | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return isUserRole(normalized) ? normalized : null;
}

function normalizeRoleCode(value: unknown): UserRole | null {
  if (typeof value === "number") {
    if (value === 1) return "revisor";
    if (value === 2) return "usuario";
    return null;
  }

  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();

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

  if (normalized.includes("usuario")) return "usuario";
  if (normalized.includes("super")) return "usuario";
  if (normalized.includes("revi")) return "revisor";

  return null;
}

async function getRoleFromUserRolesTable(
  supabase: SupabaseClient,
  userId: string
): Promise<UserRole> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("No existe un registro en user_roles para este usuario");
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
    throw new Error(
      "No se encontró una columna de rol válida en user_roles. Columnas: " +
        keys.join(", ")
    );
  }

  return role;
}

export default async function PlatformPage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
    redirect("/?error=" + encodeURIComponent("Configura Supabase primero (env vars)."));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  let role: UserRole;
  try {
    role = await getRoleFromUserRolesTable(supabase, user.id);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error desconocido";
    redirect("/?error=" + encodeURIComponent("Rol: " + message));
  }

  const platformTitle =
    role === "usuario" ? "Plataforma (Supervisor)" : "Plataforma (Revisor)";

  const sections: SidebarSection[] =
    role === "usuario"
      ? [
          {
            title: platformTitle,
            items: [
              { title: "Mi Rendimiento", href: "/platform" },
              { title: "Status", href: "/platform/status" },
              { title: "Bandeja de Entrada", href: "/platform/bandeja" },
              { title: "Task", href: "/platform/task" },
            ],
          },
          {
            title: "Herramientas",
            items: [
              { title: "Chat Directo", href: "/platform/chat" },
              { title: "Correos", href: "/platform/correos" },
              { title: "Documentos", href: "/platform/documentos" },
              { title: "Planificador", href: "/platform/planificador" },
            ],
          },
          {
            title: "Setting",
            items: [
              { title: "Notificaciones", href: "/platform/settings/notificaciones" },
              { title: "Configuracion", href: "/platform/settings/configuracion" },
            ],
          },
        ]
      : [
          {
            title: platformTitle,
            items: [
              { title: "Dashboard", href: "/platform" },
              { title: "Asignacion", href: "/platform/revisor/asignacion" },
              { title: "Supervisores", href: "/platform/supervisores" },
              { title: "Task", href: "/platform/task" },
            ],
          },
          {
            title: "Herramientas",
            items: [
              { title: "Chat Directo", href: "/platform/chat" },
              { title: "Correos", href: "/platform/correos" },
              { title: "Documentos", href: "/platform/documentos" },
              { title: "Planificador", href: "/platform/planificador" },
            ],
          },
          {
            title: "Setting",
            items: [
              { title: "Roles", href: "/platform/settings/roles" },
              { title: "Usuarios", href: "/platform/settings/usuarios" },
              { title: "Notificacion", href: "/platform/settings/notificacion" },
            ],
          },
        ];

  return (
    <PlatformShell
      sections={sections}
      currentUserId={user.id}
      currentUserEmail={user.email ?? undefined}
    />
  );
}
