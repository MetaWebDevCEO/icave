import { PlatformShell } from "@/app/platform/platform-shell";
import type { SidebarSection } from "@/app/platform/components/sidebar";
import { createClient } from "@/utils/supabase/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { buildSections, resolveRoleForUser, type UserRole } from "@/lib/platform-roles";
import { formatCalendarDateShort } from "@/lib/calendar-date";

type NotificacionRow = {
  id: string;
  created_at: string | null;
  title: string | null;
  body: string | null;
  type: string | null;
  href: string | null;
  read_at: string | null;
};

function normalizeEmail(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Bandeja de notificaciones del usuario autenticado.
 * La comparten la ruta del supervisor y la del revisor.
 */
export async function NotificacionesPage({ basePath }: { basePath: string }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
    redirect("/?error=" + encodeURIComponent("Configura Supabase primero (env vars)."));
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    redirect("/auth/login");
  }

  let role: UserRole = "usuario";
  try {
    role = await resolveRoleForUser(supabase, user.id, { email: user.email ?? null });
  } catch {
    role = "usuario";
  }
  const sections: SidebarSection[] = buildSections(role);

  const admin =
    serviceKey && !serviceKey.includes("__REPLACE_ME__")
      ? createSupabaseAdminClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;
  const readClient = admin ?? supabase;

  const email = normalizeEmail(user.email);
  let notificaciones: NotificacionRow[] = [];
  let tableMissing = false;

  if (email) {
    const result = await readClient
      .from("notificaciones")
      .select("id, created_at, title, body, type, href, read_at")
      .ilike("user_email", email)
      .order("created_at", { ascending: false })
      .limit(100);

    if (result.error) {
      const message = (result.error.message ?? "").toLowerCase();
      tableMissing =
        result.error.code === "PGRST205" ||
        message.includes("could not find the table") ||
        message.includes("schema cache");
    } else {
      notificaciones = (result.data ?? []) as unknown as NotificacionRow[];
    }
  }

  const sinLeer = notificaciones.filter((n) => !n.read_at).length;

  async function marcarComoLeidas() {
    "use server";

    const srvUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const srvAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const srvService = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!srvUrl || !srvAnon || srvUrl.includes("__REPLACE_ME__") || srvAnon.includes("__REPLACE_ME__")) {
      return;
    }

    const srvSupabase = await createClient();
    const {
      data: { user: caller },
    } = await srvSupabase.auth.getUser();
    if (!caller) return;

    const callerEmail = normalizeEmail(caller.email);
    if (!callerEmail) return;

    const srvAdmin =
      srvService && !srvService.includes("__REPLACE_ME__")
        ? createSupabaseAdminClient(srvUrl, srvService, {
            auth: { persistSession: false, autoRefreshToken: false },
          })
        : null;
    const writeClient = srvAdmin ?? srvSupabase;

    await writeClient
      .from("notificaciones")
      .update({ read_at: new Date().toISOString() })
      .ilike("user_email", callerEmail)
      .is("read_at", null);

    revalidatePath(basePath);
  }

  return (
    <PlatformShell
      sections={sections}
      currentUserId={user.id}
      currentUserEmail={user.email ?? undefined}
    >
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              Notificaciones
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Avisos de devoluciones y cambios en tus actividades asignadas.
            </p>
          </div>

          {sinLeer > 0 && (
            <form action={marcarComoLeidas}>
              <button
                type="submit"
                className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:hover:bg-zinc-900"
              >
                Marcar todo como leído
              </button>
            </form>
          )}
        </div>

        {tableMissing ? (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
            Falta crear la tabla <code className="font-mono">public.notificaciones</code>.
            Aplica la migración <code className="font-mono">20261021000000_create_notificaciones.sql</code>{" "}
            para empezar a recibir avisos.
          </div>
        ) : notificaciones.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-4 py-12 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
            No tienes notificaciones por el momento.
          </div>
        ) : (
          <div className="mt-6 grid gap-2">
            {notificaciones.map((n) => {
              const unread = !n.read_at;
              return (
                <div
                  key={n.id}
                  className={[
                    "rounded-lg border px-4 py-3",
                    unread
                      ? "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950"
                      : "border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/30",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span
                        className={[
                          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                          unread ? "bg-rose-500" : "bg-transparent",
                        ].join(" ")}
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                          {n.title ?? "Notificación"}
                        </div>
                        {n.body && (
                          <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                            {n.body}
                          </div>
                        )}
                        {n.href && (
                          <a
                            href={n.href}
                            className="mt-2 inline-block text-xs font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50"
                          >
                            Ver actividad
                          </a>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                      {formatCalendarDateShort(n.created_at)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PlatformShell>
  );
}
