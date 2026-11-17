import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ModulosGrid } from "@/app/platform/components/modulos-grid";
import { resolveRoleForUser, type UserRole } from "@/lib/platform-roles";

export default async function PlatformPage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
    redirect("/?error=" + encodeURIComponent("Configura Supabase primero (env vars)."));
  }

  const supabase = (await createClient()) as unknown as SupabaseClient;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  // El rol define el destino de cada módulo (p. ej. Gestión de actividades).
  let role: UserRole = "usuario";
  try {
    role = await resolveRoleForUser(supabase, user.id, { email: user.email ?? null });
  } catch {
    role = "usuario";
  }

  const email = (user.email ?? user.id).trim();
  const initials =
    (email.split("@")[0] ?? "")
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "U";

  // Avatar del usuario desde Supabase Storage (mismo criterio que el sidebar).
  const metadata =
    user.user_metadata && typeof user.user_metadata === "object"
      ? (user.user_metadata as Record<string, unknown>)
      : null;
  const bucket =
    metadata && typeof metadata.avatar_bucket === "string" && metadata.avatar_bucket.trim()
      ? metadata.avatar_bucket.trim()
      : "avatars";
  const avatarPath =
    metadata && typeof metadata.avatar_path === "string" ? metadata.avatar_path.trim() : "";

  let avatarUrl: string | null = null;
  if (avatarPath) {
    try {
      const { data } = await supabase.storage.from(bucket).createSignedUrl(avatarPath, 60 * 10);
      avatarUrl = data?.signedUrl ?? null;
    } catch {
      avatarUrl = null;
    }
  }

  return (
    <div className="min-h-screen bg-[#f4f5f7] font-sans text-[#141414]">
      <main className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="mb-7 flex items-start justify-between gap-4">
          <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-[#141414]">
            ¿En qué vas a trabajar?
          </h1>

          <div className="flex shrink-0 items-center gap-3 rounded-full border border-[#e6e8ec] bg-white py-1.5 pl-1.5 pr-4 shadow-[0_1px_2px_rgba(20,20,20,0.04)]">
            <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-[#032f6c] text-xs font-semibold text-white">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={`Avatar de ${email}`}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              ) : (
                initials
              )}
            </span>
            <span className="max-w-[14rem] truncate text-sm font-medium text-[#2b2926]">
              {email}
            </span>
          </div>
        </div>

        <ModulosGrid role={role} />
      </main>
    </div>
  );
}
