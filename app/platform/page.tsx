import { PlatformShell } from "@/app/platform/platform-shell";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import {
  resolveRoleForUser,
  buildSections,
  dashboardForRole,
} from "@/lib/platform-roles";

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

  const role = await resolveRoleForUser(supabase, user.id);
  const sections = buildSections(role);

  return (
    <PlatformShell
      sections={sections}
      currentUserId={user.id}
      currentUserEmail={user.email ?? undefined}
    >
      <div className="mx-auto max-w-6xl">
        <div className="rounded-lg border border-zinc-200 bg-white px-6 py-5 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
            {role === "revisor" ? "Dashboard Revisor" : "Mi Rendimiento"}
          </div>
          <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {role === "revisor"
              ? "Panel general de revisores. Usa el menú lateral para ver Asignacion, Supervisores o Task."
              : "Panel de supervisor. Usa el menú lateral para ver Bandeja, Status o Task."}
          </div>
          <div className="mt-4">
            <a
              href={
                role === "revisor"
                  ? "/platform/revisor/task"
                  : "/platform/supervisor/bandeja"
              }
              className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Ir a la sección principal
            </a>
          </div>
        </div>
      </div>
    </PlatformShell>
  );
}
