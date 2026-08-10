import { PlatformShell } from "@/app/platform/platform-shell";
import { createClient } from "@/utils/supabase/server";
import { getRoleFromUserRolesTable, buildSections } from "@/lib/platform-roles";
import { redirect } from "next/navigation";

export default async function SupervisorStatusPage() {
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

  let role: "revisor" | "usuario";
  try {
    role = await getRoleFromUserRolesTable(supabase, user.id);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error desconocido";
    redirect("/?error=" + encodeURIComponent("Rol: " + message));
  }

  if (role !== "usuario") {
    redirect("/platform");
  }

  const sections = buildSections("usuario");

  return (
    <PlatformShell
      sections={sections}
      currentUserId={user.id}
      currentUserEmail={user.email ?? undefined}
    >
      <div className="mx-auto max-w-7xl">
        <div>
          <h1 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
            Status
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Vista de estado del supervisor.
          </p>
        </div>
      </div>
    </PlatformShell>
  );
}
