"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/utils/supabase/client";

type UserRow = {
  id: string;
  email: string | null;
  createdAt: string | null;
};

type RoleOption = {
  code: string;
  label: string;
};

type PresenceState = Record<string, Array<Record<string, unknown>>>;

function titleCase(value: string) {
  return value
    .split(/[\s._-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatNameFromEmail(email: string | null) {
  if (!email) return "Sin nombre";
  const local = email.split("@")[0] ?? email;
  return titleCase(local);
}

function initialsFromName(name: string) {
  const parts = name.split(/\s+/g).filter(Boolean);
  const first = parts[0]?.[0] ?? "U";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] : "";
  return (first + last).toUpperCase();
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
  onUpdate: (formData: FormData) => void;
}) {
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
              <th className="w-28 px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {users.map((u) => {
              const name = formatNameFromEmail(u.email);
              const initials = initialsFromName(name);
              const selected = selectedIds.has(u.id);
              const isOnline = onlineIds.has(u.id);
              const currentRoleCode = roleByUserId[u.id] ?? "";
              const formId = `role-form-${u.id}`;

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
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">{u.email ?? "-"}</td>
                  <td className="px-4 py-3">
                    <form id={formId} action={onUpdate}>
                      <input type="hidden" name="user_id" value={u.id} />
                      <select
                        name="role_code"
                        defaultValue={currentRoleCode}
                        disabled={!canEdit}
                        className="h-10 w-56 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-50 disabled:opacity-50"
                      >
                        <option value="" disabled>
                          Seleccionar
                        </option>
                        {roleOptions.map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </form>
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
                    <button
                      type="submit"
                      form={formId}
                      disabled={!canEdit}
                      className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-50"
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
