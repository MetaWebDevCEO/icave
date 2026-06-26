"use client";

import { useEffect, useMemo, useState } from "react";

import { createClient } from "@/utils/supabase/client";

type RoleRow = {
  userId: string;
  roleCode: string | null;
};

type UserRow = {
  id: string;
  email: string | null;
  createdAt: string | null;
  displayName: string;
  avatarUrl: string | null;
};

type PresenceState = Record<string, Array<Record<string, unknown>>>;

function titleCase(value: string) {
  return value
    .split(/[\s._-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function initialsFromName(name: string) {
  const parts = name.split(/\s+/g).filter(Boolean);
  const first = parts[0]?.[0] ?? "U";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] : "";
  return (first + last).toUpperCase();
}

export function UsersTable({
  users,
  roles,
  currentUserId,
  onDelete,
}: {
  users: UserRow[];
  roles: RoleRow[];
  currentUserId: string;
  onDelete: (formData: FormData) => void;
}) {
  const rolesMap = useMemo(() => {
    const map = new Map<string, string | null>();
    roles.forEach((r) => map.set(r.userId, r.roleCode));
    return map;
  }, [roles]);

  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase.channel("online-users", {
      config: { presence: { key: currentUserId } },
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState() as PresenceState;
      setOnlineIds(new Set(Object.keys(state)));
    });

    channel.subscribe(async (status) => {
      if (status !== "SUBSCRIBED") return;
      await channel.track({ online_at: new Date().toISOString() });
    });

    const interval = setInterval(() => {
      channel.track({ online_at: new Date().toISOString() });
    }, 25000);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [currentUserId]);

  const allSelected = selectedIds.size > 0 && selectedIds.size === users.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < users.length;

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900/40 dark:text-zinc-400">
            <tr>
              <th className="w-12 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (!el) return;
                    el.indeterminate = someSelected;
                  }}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedIds(new Set(users.map((u) => u.id)));
                      return;
                    }
                    setSelectedIds(new Set());
                  }}
                  className="h-4 w-4 rounded border-zinc-300 text-zinc-900 dark:border-zinc-700 dark:bg-black"
                  aria-label="Seleccionar todos"
                />
              </th>
              <th className="px-4 py-3">Nombre</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Rol</th>
              <th className="px-4 py-3">Fecha alta</th>
              <th className="px-4 py-3">Estado</th>
              <th className="w-16 px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {users.map((u) => {
              const roleCode = rolesMap.get(u.id);
              const roleLabel = roleCode ?? "-";
              const normalizedRole =
                typeof roleCode === "string" ? roleCode.trim().toLowerCase() : "";
              const isOnline = onlineIds.has(u.id);
              const name = u.displayName || titleCase(u.email?.split("@")[0] ?? "Sin nombre");
              const initials = initialsFromName(name);
              const selected = selectedIds.has(u.id);

              return (
                <tr key={u.id} className="text-zinc-900 dark:text-zinc-100">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(e) => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(u.id);
                          else next.delete(u.id);
                          return next;
                        });
                      }}
                      className="h-4 w-4 rounded border-zinc-300 text-zinc-900 dark:border-zinc-700 dark:bg-black"
                      aria-label={`Seleccionar ${u.email ?? u.id}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-zinc-200 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                        {u.avatarUrl ? (
                          <img
                            src={u.avatarUrl}
                            alt={`Avatar de ${name}`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          initials
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">{u.email ?? "-"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={[
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                        normalizedRole.includes("revi")
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
                          : normalizedRole.includes("usu") ||
                              normalizedRole.includes("admin")
                            ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200"
                            : "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
                      ].join(" ")}
                    >
                      {roleLabel}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "-"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={[
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                        isOnline
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
                          : "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
                      ].join(" ")}
                    >
                      {isOnline ? "Online" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <form action={onDelete}>
                        <input type="hidden" name="user_id" value={u.id} />
                        <button
                          type="submit"
                          className="inline-flex h-9 items-center justify-center rounded-md border border-red-200 bg-white px-3 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900/40 dark:bg-black dark:text-red-200 dark:hover:bg-red-950/40 disabled:opacity-50"
                          disabled={u.id === currentUserId}
                        >
                          Eliminar
                        </button>
                      </form>
                    </div>
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
