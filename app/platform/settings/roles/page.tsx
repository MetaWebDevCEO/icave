import { PlatformShell } from "@/app/platform/platform-shell";
import type { SidebarSection } from "@/app/platform/components/sidebar";
import { createClient } from "@/utils/supabase/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { RolesTable } from "@/app/platform/settings/roles/roles-table";

type UserRole = "revisor" | "usuario";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type RoleOption = {
  code: string;
  label: string;
};

function normalizeRoleCode(value: unknown): UserRole | null {
  if (typeof value === "number") {
    if (value === 1) return "revisor";
    if (value === 2) return "usuario";
    return null;
  }

  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();

  if (normalized === "revisor") return "revisor";
  if (normalized === "usuario") return "usuario";

  if (normalized.includes("revi")) return "revisor";
  if (normalized.includes("admin")) return "usuario";
  if (normalized.includes("usuario")) return "usuario";

  return null;
}

async function getRoleFromUserRolesTable(userId: string): Promise<UserRole> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_roles")
    .select("role_code")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  const role = normalizeRoleCode(data?.role_code);
  if (!role) throw new Error("Rol inválido");
  return role;
}

function getSearchParam(
  sp: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = sp[key];
  return typeof value === "string" ? value : undefined;
}

function buildSections(role: UserRole): SidebarSection[] {
  const platformTitle =
    role === "usuario" ? "Plataforma (Supervisor)" : "Plataforma (Revisor)";

  return role === "usuario"
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
}

export default async function RolesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

  const currentRole = await getRoleFromUserRolesTable(user.id);
  const sections = buildSections(currentRole);

  const sp = await searchParams;
  const errorParam = getSearchParam(sp, "error");
  const messageParam = getSearchParam(sp, "message");

  if (!serviceKey || serviceKey.includes("__REPLACE_ME__")) {
    return (
      <PlatformShell
        sections={sections}
        currentUserId={user.id}
        currentUserEmail={user.email ?? undefined}
      >
        <div className="mx-auto max-w-6xl">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
            Falta configurar SUPABASE_SERVICE_ROLE_KEY en .env.local para poder administrar roles.
          </div>
        </div>
      </PlatformShell>
    );
  }

  const admin = createSupabaseAdminClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function updateUserRole(formData: FormData) {
    "use server";

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
      redirect("/?error=" + encodeURIComponent("Configura Supabase primero (env vars)."));
    }

    if (!serviceKey || serviceKey.includes("__REPLACE_ME__")) {
      redirect(
        "/platform/settings/roles?error=" +
          encodeURIComponent("Falta SUPABASE_SERVICE_ROLE_KEY.")
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      redirect("/");
    }

    const currentRole = await getRoleFromUserRolesTable(user.id);
    if (currentRole !== "revisor") {
      redirect(
        "/platform/settings/roles?error=" +
          encodeURIComponent("No tienes permisos para cambiar roles.")
      );
    }

    const targetUserId = String(formData.get("user_id") ?? "");
    const roleCode = String(formData.get("role_code") ?? "");

    if (!targetUserId || !roleCode) {
      redirect(
        "/platform/settings/roles?error=" +
          encodeURIComponent("Faltan datos para actualizar el rol.")
      );
    }

    const admin = createSupabaseAdminClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error } = await admin
      .from("user_roles")
      .upsert({ user_id: targetUserId, role_code: roleCode }, { onConflict: "user_id" });

    if (error) {
      redirect("/platform/settings/roles?error=" + encodeURIComponent(error.message));
    }

    redirect("/platform/settings/roles?message=" + encodeURIComponent("Rol actualizado."));
  }

  const [
    { data: usersData, error: usersError },
    { data: rolesData, error: rolesError },
    { data: userRolesData, error: userRolesError },
  ] = await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
    admin.from("roles").select("code, name"),
    admin.from("user_roles").select("user_id, role_code"),
  ]);

  if (usersError) {
    return (
      <PlatformShell
        sections={sections}
        currentUserId={user.id}
        currentUserEmail={user.email ?? undefined}
      >
        <div className="mx-auto max-w-6xl">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100">
            {usersError.message}
          </div>
        </div>
      </PlatformShell>
    );
  }

  if (rolesError || userRolesError) {
    const message =
      rolesError?.message ?? userRolesError?.message ?? "Error desconocido";
    return (
      <PlatformShell
        sections={sections}
        currentUserId={user.id}
        currentUserEmail={user.email ?? undefined}
      >
        <div className="mx-auto max-w-6xl">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100">
            {message}
          </div>
        </div>
      </PlatformShell>
    );
  }

  const roleOptionByLabel = new Map<string, RoleOption>();
  (rolesData ?? []).forEach((r) => {
    const row = r as { code: unknown; name: unknown };
    const code = String(row.code);
    const normalized = code.trim().toLowerCase();

    const label = normalized.includes("revi")
      ? "Revisor"
      : normalized.includes("usu") || normalized.includes("admin")
        ? "Supervisor"
        : null;

    if (!label) return;

    const existing = roleOptionByLabel.get(label);
    if (!existing) {
      roleOptionByLabel.set(label, { code, label });
      return;
    }

    if (
      label === "Supervisor" &&
      existing.code.trim().toLowerCase().includes("admin") &&
      normalized.includes("usu")
    ) {
      roleOptionByLabel.set(label, { code, label });
    }
  });

  const roles: RoleOption[] = ["Supervisor", "Revisor"]
    .map((label) => roleOptionByLabel.get(label))
    .filter((v): v is RoleOption => Boolean(v));

  const userRoles = new Map<string, string>();
  (userRolesData ?? []).forEach((row) => {
    const r = row as { user_id: unknown; role_code: unknown };
    if (typeof r.user_id === "string" && typeof r.role_code === "string") {
      userRoles.set(r.user_id, r.role_code);
    }
  });

  const users = usersData?.users ?? [];
  const canEdit = currentRole === "revisor";
  const roleByUserId: Record<string, string | undefined> = {};
  userRoles.forEach((value, key) => {
    roleByUserId[key] = value;
  });

  const clientUsers = users.map((u) => {
    return {
      id: u.id,
      email: u.email ?? null,
      createdAt: u.created_at ?? null,
    };
  });

  return (
    <PlatformShell
      sections={sections}
      currentUserId={user.id}
      currentUserEmail={user.email ?? undefined}
    >
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">Roles</h1>
          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            {users.length} usuarios
          </div>
        </div>

        {currentRole !== "revisor" && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
            Solo el rol <span className="font-medium">Revisor</span> puede cambiar roles.
          </div>
        )}

        {(errorParam || messageParam) && (
          <div
            className={[
              "mt-4 rounded-lg border p-4 text-sm",
              errorParam
                ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100"
                : "border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-100",
            ].join(" ")}
          >
            {errorParam ?? messageParam}
          </div>
        )}

        <RolesTable
          users={clientUsers}
          currentUserId={user.id}
          roleByUserId={roleByUserId}
          roleOptions={roles}
          canEdit={canEdit}
          onUpdate={updateUserRole}
        />
      </div>
    </PlatformShell>
  );
}
