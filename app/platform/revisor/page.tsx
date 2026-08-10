import { PlatformShell } from "@/app/platform/platform-shell";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import {
  getRoleFromUserRolesTable,
  buildSections,
  type UserRole,
} from "@/lib/platform-roles";

export default async function RevisorDashboardPage() {
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

  if (role !== "revisor") {
    redirect("/platform");
  }

  const sections = buildSections(role);

  return (
    <PlatformShell
      sections={sections}
      currentUserId={user.id}
      currentUserEmail={user.email ?? undefined}
    />
  );
}
