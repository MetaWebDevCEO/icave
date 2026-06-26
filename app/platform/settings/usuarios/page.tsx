import { PlatformShell } from "@/app/platform/platform-shell";
import type { SidebarSection } from "@/app/platform/components/sidebar";
import { createClient } from "@/utils/supabase/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { UsersTable } from "@/app/platform/settings/usuarios/users-table";

type UserRole = "revisor" | "usuario";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

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

export default async function UsuariosPage({
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

  const role = await getRoleFromUserRolesTable(user.id);
  if (role !== "revisor") {
    redirect("/platform");
  }
  const sections = buildSections(role);

  async function deleteUser(formData: FormData) {
    "use server";

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
      redirect("/?error=" + encodeURIComponent("Configura Supabase primero (env vars)."));
    }

    if (!serviceKey || serviceKey.includes("__REPLACE_ME__")) {
      redirect(
        "/platform/settings/usuarios?error=" +
          encodeURIComponent("Falta SUPABASE_SERVICE_ROLE_KEY para eliminar usuarios.")
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
        "/platform/settings/usuarios?error=" +
          encodeURIComponent("No tienes permisos para eliminar usuarios.")
      );
    }

    const targetUserId = String(formData.get("user_id") ?? "");
    if (!targetUserId) {
      redirect(
        "/platform/settings/usuarios?error=" +
          encodeURIComponent("Falta user_id.")
      );
    }

    if (targetUserId === user.id) {
      redirect(
        "/platform/settings/usuarios?error=" +
          encodeURIComponent("No puedes eliminar tu propio usuario.")
      );
    }

    const admin = createSupabaseAdminClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    await admin.from("user_roles").delete().eq("user_id", targetUserId);

    const { error } = await admin.auth.admin.deleteUser(targetUserId);
    if (error) {
      redirect(
        "/platform/settings/usuarios?error=" + encodeURIComponent(error.message)
      );
    }

    redirect("/platform/settings/usuarios?message=" + encodeURIComponent("Usuario eliminado."));
  }

  if (!serviceKey || serviceKey.includes("__REPLACE_ME__")) {
    return (
      <PlatformShell
        sections={sections}
        currentUserId={user.id}
        currentUserEmail={user.email ?? undefined}
      >
        <div className="mx-auto max-w-6xl">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
            Falta configurar SUPABASE_SERVICE_ROLE_KEY en .env.local para poder listar usuarios.
          </div>
        </div>
      </PlatformShell>
    );
  }

  const admin = createSupabaseAdminClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [{ data: usersData, error: usersError }, { data: rolesData }] =
    await Promise.all([
      admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
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

  const users = usersData?.users ?? [];
  const sp = await searchParams;
  const errorParam = getSearchParam(sp, "error");
  const messageParam = getSearchParam(sp, "message");

  const roles = (rolesData ?? []).map((row) => {
    const r = row as { user_id: unknown; role_code: unknown };
    return {
      userId: String(r.user_id),
      roleCode: typeof r.role_code === "string" ? r.role_code : null,
    };
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
          <h1 className="text-lg font-semibold">Usuarios</h1>
          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            {users.length} resultados
          </div>
        </div>

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

        <UsersTable
          users={clientUsers}
          roles={roles}
          currentUserId={user.id}
          onDelete={deleteUser}
        />
      </div>
    </PlatformShell>
  );
}
