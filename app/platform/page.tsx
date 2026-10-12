import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { resolveRoleForUser } from "@/lib/platform-roles";

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

  // Resolvemos el rol y redirigimos al dashboard de cada perfil.
  // - Revisor  -> /platform/revisor       (dashboard con estadísticas)
  // - Usuario (Supervisor) -> /platform/supervisor/bandeja
  let role = "usuario";
  try {
    role = await resolveRoleForUser(supabase, user.id);
  } catch {
    role = "usuario";
  }

  if (role === "revisor") {
    redirect("/platform/revisor");
  }

  redirect("/platform/supervisor/bandeja");
}
