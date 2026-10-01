"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/utils/supabase/client";
import { Avatar } from "@/components/ui/avatar";

type UserRow = {
  id: string;
  email: string | null;
  createdAt: string | null;
  displayName: string;
  avatarUrl: string | null;
};

type RoleOption = {
  code: string;
  label: string;
};

type PresenceState = Record<string, Array<Record<string, unknown>>>;

type ServerActionResult = { ok: boolean; url: string };

function titleCase(value: string) {
  return value
    .split(/[\s._-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function RolesTable({
  users,
  currentUserId,
  roleByUserId,
  roleOptions,
  canEdit,
  onUpdate,
}: {
  users: UserRow[];
  currentUserId: string;
  roleByUserId: Record<string, string | undefined>;
  roleOptions: RoleOption[];
  canEdit: boolean;
  onUpdate: (formData: FormData) => Promise<ServerActionResult>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());

  function runAction(
    action: (formData: FormData) => Promise<ServerActionResult>,
    formData: FormData
  ) {
    startTransition(async () => {
      try {
        const res = await action(formData);
        if (res?.url) router.replace(res.url);
      } catch (e) {
        console.debug("[roles-table] action exception:", e);
      }
    });
  }

  useEffect(() => {
    let channel: ReturnType<ReturnType<typeof createClient>["channel"]> | null =
      null;
    let interval: ReturnType<typeof setInterval> | null = null;
    let supabase: ReturnType<typeof createClient> | null = null;

    try {
      supabase = createClient();

      channel = supabase.channel("online-users", {
        config: { presence: { key: currentUserId } },
      });

      channel.on("presence", { event: "sync" }, () => {
        if (!channel) return;
        const state = channel.presenceState() as PresenceState;
        setOnlineIds(new Set(Object.keys(state)));
      });

      channel.subscribe(async (status) => {
        if (status !== "SUBSCRIBED" || !channel) return;
        try {
          await channel.track({ online_at: new Date().toISOString() });
        } catch {
          /* ignore */
        }
      });

      interval = setInterval(() => {
        if (!channel) return;
        try {
          void channel.track({ online_at: new Date().toISOString() });
        } catch {
          /* ignore */
        }
      }, 30000);
    } catch {
      /* ignore presence setup errors */
    }

    return () => {
      if (interval) clearInterval(interval);
      if (channel && supabase) {
        try {
          void supabase.removeChannel(channel as never);
        } catch {
          /* ignore */
        }
      }
    };
  }, [currentUserId]);

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50/60 text-left text-xs uppercase tracking-wider text-zinc-500 dark:bg-zinc-900/50 dark:text-zinc-400">
            <tr>
              <th className="px-6 py-4 font-medium">Usuario</th>
              <th className="px-6 py-4 font-medium">Email</th>
              <th className="px-6 py-4 font-medium">Rol</th>
              <th className="px-6 py-4 font-medium">Fecha alta</th>
              <th className="px-6 py-4 font-medium">Estado</th>
              <th className="w-32 px-6 py-4 text-right font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  No se encontraron usuarios. Asegúrate de que <span className="font-mono">SUPABASE_SERVICE_ROLE_KEY</span> esté configurado.
                </td>
              </tr>
            )}
            {users.map((u) => {
              const name =
                u.displayName || titleCase(u.email?.split("@")[0] ?? "Sin nombre");
              const isOnline = onlineIds.has(u.id);
              const isMe = u.id === currentUserId;
              const currentRoleCode = roleByUserId[u.id] ?? "";
              const formId = `role-form-${u.id}`;

              return (
                <tr
                  key={u.id}
                  className="text-zinc-900 transition-colors hover:bg-zinc-50/50 dark:text-zinc-100 dark:hover:bg-zinc-900/30"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <Avatar
                        src={u.avatarUrl}
                        alt={`Avatar de ${name}`}
                        initials={name}
                        className="h-9 w-9 text-xs"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="truncate font-medium">{name}</div>
                          {isMe && (
                            <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-white dark:bg-white dark:text-zinc-900">
                              Tú
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-zinc-600 dark:text-zinc-300">
                    {u.email ?? "—"}
                  </td>
                  <td className="px-6 py-4">
                    <form
                      id={formId}
                      onSubmit={(event) => {
                        event.preventDefault();
                        const fd = new FormData(event.currentTarget);
                        runAction(onUpdate, fd);
                      }}
                    >
                      <input type="hidden" name="user_id" value={u.id} />
                      <div className="relative inline-flex w-full max-w-[260px]">
                        <select
                          name="role_code"
                          defaultValue={currentRoleCode}
                          disabled={!canEdit || isPending}
                          className="h-10 w-full appearance-none rounded-xl border border-zinc-200 bg-white px-4 pr-10 text-sm text-zinc-950 outline-none transition-all focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-800 dark:bg-black dark:text-zinc-50 dark:focus:border-zinc-600 dark:focus:ring-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
                          aria-label={`Rol de ${u.email ?? u.id}`}
                        >
                          <option value="" disabled>
                            Sin asignar
                          </option>
                          {roleOptions.map((r) => (
                            <option key={r.code} value={r.code}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500 dark:text-zinc-400"
                        >
                          <path
                            fillRule="evenodd"
                            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </div>
                    </form>
                  </td>
                  <td className="px-6 py-4 text-xs text-zinc-500 dark:text-zinc-400">
                    {u.createdAt
                      ? (() => {
                          const d = new Date(u.createdAt);
                          if (Number.isNaN(d.getTime())) return u.createdAt.slice(0, 10);
                          const dd = String(d.getUTCDate()).padStart(2, "0");
                          const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
                          const yyyy = d.getUTCFullYear();
                          return `${dd}/${mm}/${yyyy}`;
                        })()
                      : "—"}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={[
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                        isOnline
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
                          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300",
                      ].join(" ")}
                    >
                      <span
                        aria-hidden="true"
                        className={[
                          "h-1.5 w-1.5 rounded-full",
                          isOnline ? "bg-emerald-500" : "bg-zinc-400",
                        ].join(" ")}
                      />
                      {isOnline ? "En línea" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      type="submit"
                      form={formId}
                      disabled={!canEdit || isPending}
                      className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-4 text-xs font-medium text-white shadow-sm transition-all hover:bg-zinc-700 active:scale-[0.98] dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 disabled:bg-zinc-200 disabled:text-zinc-500 disabled:hover:bg-zinc-200 disabled:cursor-not-allowed disabled:shadow-none disabled:active:scale-100 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500 dark:disabled:hover:bg-zinc-800"
                    >
                      Guardar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
