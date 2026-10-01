"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/utils/supabase/client";
import { Avatar } from "@/components/ui/avatar";

type RoleRow = {
  userId: string;
  roleCode: string | null;
  roleLabel: string;
};

type UserRow = {
  id: string;
  email: string | null;
  createdAt: string | null;
  displayName: string;
  avatarUrl: string | null;
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

export function UsersTable({
  users,
  roles,
  currentUserId,
  canEdit,
  onDelete,
  onCreate,
  onUpdate,
}: {
  users: UserRow[];
  roles: RoleRow[];
  currentUserId: string;
  canEdit: boolean;
  onDelete: (formData: FormData) => Promise<ServerActionResult>;
  onCreate?: (formData: FormData) => Promise<ServerActionResult>;
  onUpdate?: (formData: FormData) => Promise<ServerActionResult>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [formNombre, setFormNombre] = useState("");
  const [formCorreo, setFormCorreo] = useState("");
  const [formContrasena, setFormContrasena] = useState("");
  const [formRol, setFormRol] = useState("usuario");
  const [showContrasena, setShowContrasena] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState("");
  const [editCorreo, setEditCorreo] = useState("");
  const [editContrasena, setEditContrasena] = useState("");
  const [editRol, setEditRol] = useState("usuario");
  const [showEditContrasena, setShowEditContrasena] = useState(false);

  function runAction(
    action: (formData: FormData) => Promise<ServerActionResult>,
    formData: FormData
  ) {
    startTransition(async () => {
      try {
        const res = await action(formData);
        if (res?.url) router.replace(res.url);
      } catch (e) {
        console.debug("[users-table] action exception:", e);
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

  const rolesMap = new Map<string, RoleRow>();
  for (const r of roles) {
    rolesMap.set(r.userId, r);
  }

  function openEdit(u: UserRow) {
    setEditUserId(u.id);
    setEditNombre(u.displayName || "");
    setEditCorreo(u.email || "");
    setEditContrasena("");
    const roleRow = rolesMap.get(u.id);
    setEditRol(roleRow?.roleCode || "usuario");
    setEditOpen(true);
  }

  return (
    <>
      <div className="flex justify-end mb-4">
        {onCreate && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            disabled={!canEdit}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white shadow-sm transition-all hover:bg-zinc-700 active:scale-[0.98] dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 disabled:bg-zinc-200 disabled:text-zinc-500 disabled:hover:bg-zinc-200 disabled:cursor-not-allowed disabled:shadow-none disabled:active:scale-100 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500 dark:disabled:hover:bg-zinc-800"
          >
            Crear usuario
          </button>
        )}
      </div>

      {createOpen && (
        <div
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setCreateOpen(false)}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  Crear nuevo usuario
                </h2>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  La cuenta se creará con correo confirmado.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
                aria-label="Cerrar"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-4 w-4"
                >
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 0 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                </svg>
              </button>
            </div>

            <form
              className="space-y-4 p-6"
              onSubmit={(event) => {
                event.preventDefault();
                if (!onCreate) return;
                const fd = new FormData(event.currentTarget);
                runAction(onCreate, fd);
                setTimeout(() => {
                  setCreateOpen(false);
                  setFormNombre("");
                  setFormCorreo("");
                  setFormContrasena("");
                  setFormRol("usuario");
                }, 0);
              }}
            >
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Nombre completo
                </label>
                <input
                  type="text"
                  name="nombre"
                  value={formNombre}
                  onChange={(e) => setFormNombre(e.target.value)}
                  placeholder="Ej: Juan Pérez"
                  required
                  disabled={!canEdit}
                  className="h-10 w-full appearance-none rounded-xl border border-zinc-200 bg-white px-4 text-sm text-zinc-950 placeholder:text-zinc-400 outline-none transition-all focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-800 dark:bg-black dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:border-zinc-600 dark:focus:ring-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Correo electrónico
                </label>
                <input
                  type="email"
                  name="correo"
                  value={formCorreo}
                  onChange={(e) => setFormCorreo(e.target.value)}
                  placeholder="correo@ejemplo.com"
                  required
                  disabled={!canEdit}
                  className="h-10 w-full appearance-none rounded-xl border border-zinc-200 bg-white px-4 text-sm text-zinc-950 placeholder:text-zinc-400 outline-none transition-all focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-800 dark:bg-black dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:border-zinc-600 dark:focus:ring-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Contraseña
                </label>
                <div className="relative">
                  <input
                    type={showContrasena ? "text" : "password"}
                    name="contrasena"
                    value={formContrasena}
                    onChange={(e) => setFormContrasena(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    minLength={6}
                    required
                    disabled={!canEdit}
                    className="h-10 w-full appearance-none rounded-xl border border-zinc-200 bg-white px-4 pr-20 text-sm text-zinc-950 placeholder:text-zinc-400 outline-none transition-all focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-800 dark:bg-black dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:border-zinc-600 dark:focus:ring-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <button
                    type="button"
                    onClick={() => setShowContrasena((v) => !v)}
                    className="absolute inset-y-0 right-0 flex h-full w-16 items-center justify-center text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                    tabIndex={-1}
                  >
                    {showContrasena ? "Ocultar" : "Ver"}
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Rol
                </label>
                <div className="relative inline-flex w-full">
                  <select
                    name="role_code"
                    value={formRol}
                    onChange={(e) => setFormRol(e.target.value)}
                    disabled={!canEdit}
                    className="h-10 w-full appearance-none rounded-xl border border-zinc-200 bg-white px-4 pr-10 text-sm text-zinc-950 outline-none transition-all focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-800 dark:bg-black dark:text-zinc-50 dark:focus:border-zinc-600 dark:focus:ring-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="usuario">Supervisor</option>
                    <option value="revisor">Revisor</option>
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
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-100 dark:border-zinc-900">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:text-zinc-300 dark:hover:bg-zinc-900/60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!canEdit}
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white shadow-sm transition-all hover:bg-zinc-700 active:scale-[0.98] dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 disabled:bg-zinc-200 disabled:text-zinc-500 disabled:hover:bg-zinc-200 disabled:cursor-not-allowed disabled:shadow-none disabled:active:scale-100 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500 dark:disabled:hover:bg-zinc-800"
                >
                  Crear
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editOpen && editUserId && onUpdate && (
        <div
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setEditOpen(false)}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  Editar usuario
                </h2>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Modifica nombre, correo, rol o asigna una nueva contraseña.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
                aria-label="Cerrar"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-4 w-4"
                >
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 0 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                </svg>
              </button>
            </div>

            <form
              className="space-y-4 p-6"
              onSubmit={(event) => {
                event.preventDefault();
                if (!onUpdate) return;
                const fd = new FormData(event.currentTarget);
                runAction(onUpdate, fd);
                setTimeout(() => {
                  setEditOpen(false);
                  setEditUserId(null);
                  setEditNombre("");
                  setEditCorreo("");
                  setEditContrasena("");
                  setEditRol("usuario");
                }, 0);
              }}
            >
              <input type="hidden" name="user_id" value={editUserId} />

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Nombre completo
                </label>
                <input
                  type="text"
                  name="nombre"
                  value={editNombre}
                  onChange={(e) => setEditNombre(e.target.value)}
                  placeholder="Nombre completo"
                  required
                  disabled={!canEdit}
                  className="h-10 w-full appearance-none rounded-xl border border-zinc-200 bg-white px-4 text-sm text-zinc-950 placeholder:text-zinc-400 outline-none transition-all focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-800 dark:bg-black dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:border-zinc-600 dark:focus:ring-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Correo electrónico
                </label>
                <input
                  type="email"
                  name="correo"
                  value={editCorreo}
                  onChange={(e) => setEditCorreo(e.target.value)}
                  placeholder="correo@ejemplo.com"
                  required
                  disabled={!canEdit}
                  className="h-10 w-full appearance-none rounded-xl border border-zinc-200 bg-white px-4 text-sm text-zinc-950 placeholder:text-zinc-400 outline-none transition-all focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-800 dark:bg-black dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:border-zinc-600 dark:focus:ring-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Nueva contraseña
                </label>
                <div className="relative">
                  <input
                    type={showEditContrasena ? "text" : "password"}
                    name="contrasena"
                    value={editContrasena}
                    onChange={(e) => setEditContrasena(e.target.value)}
                    placeholder="Dejar vacío para mantener la actual (mín. 6 caracteres)"
                    minLength={editContrasena ? 6 : undefined}
                    disabled={!canEdit}
                    className="h-10 w-full appearance-none rounded-xl border border-zinc-200 bg-white px-4 pr-20 text-sm text-zinc-950 placeholder:text-zinc-400 outline-none transition-all focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-800 dark:bg-black dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:border-zinc-600 dark:focus:ring-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEditContrasena((v) => !v)}
                    className="absolute inset-y-0 right-0 flex h-full w-16 items-center justify-center text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                    tabIndex={-1}
                  >
                    {showEditContrasena ? "Ocultar" : "Ver"}
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Rol
                </label>
                <div className="relative inline-flex w-full">
                  <select
                    name="role_code"
                    value={editRol}
                    onChange={(e) => setEditRol(e.target.value)}
                    disabled={!canEdit}
                    className="h-10 w-full appearance-none rounded-xl border border-zinc-200 bg-white px-4 pr-10 text-sm text-zinc-950 outline-none transition-all focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-800 dark:bg-black dark:text-zinc-50 dark:focus:border-zinc-600 dark:focus:ring-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="usuario">Supervisor</option>
                    <option value="revisor">Revisor</option>
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
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-100 dark:border-zinc-900">
                <button
                  type="button"
                  onClick={() => setEditOpen(false)}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:text-zinc-300 dark:hover:bg-zinc-900/60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!canEdit}
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white shadow-sm transition-all hover:bg-zinc-700 active:scale-[0.98] dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 disabled:bg-zinc-200 disabled:text-zinc-500 disabled:hover:bg-zinc-200 disabled:cursor-not-allowed disabled:shadow-none disabled:active:scale-100 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500 dark:disabled:hover:bg-zinc-800"
                >
                  Guardar cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
                <th className="w-52 px-6 py-4 text-right font-medium">Acciones</th>
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
                const roleRow = rolesMap.get(u.id);
                const roleCode = roleRow?.roleCode ?? "";
                const roleLabel = roleRow?.roleLabel ?? "Sin asignar";
                const normalizedRole =
                  typeof roleCode === "string" ? roleCode.trim().toLowerCase() : "";

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
                      <span
                        className={[
                          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                          normalizedRole.includes("revi")
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
                            : normalizedRole.includes("usu") ||
                                normalizedRole.includes("super")
                              ? "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-200"
                              : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300",
                        ].join(" ")}
                      >
                        {roleLabel}
                      </span>
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
                        {isOnline ? "Línea" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        {onUpdate && (
                          <button
                            type="button"
                            onClick={() => openEdit(u)}
                            disabled={!canEdit}
                            className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-4 text-xs font-medium text-white shadow-sm transition-all hover:bg-zinc-700 active:scale-[0.98] dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 disabled:bg-zinc-200 disabled:text-zinc-500 disabled:hover:bg-zinc-200 disabled:cursor-not-allowed disabled:shadow-none disabled:active:scale-100 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500 dark:disabled:hover:bg-zinc-800"
                          >
                            Editar
                          </button>
                        )}
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            const fd = new FormData(event.currentTarget);
                            runAction(onDelete, fd);
                          }}
                        >
                          <input type="hidden" name="user_id" value={u.id} />
                          <button
                            type="submit"
                            disabled={!canEdit || isMe || isPending}
                            className="inline-flex h-10 items-center justify-center rounded-xl border border-red-200 bg-white px-4 text-xs font-medium text-red-700 transition-all hover:bg-red-50 dark:border-red-900/40 dark:bg-black dark:text-red-200 dark:hover:bg-red-950/40 disabled:border-zinc-200 disabled:text-zinc-500 disabled:hover:bg-white disabled:cursor-not-allowed dark:disabled:border-zinc-800 dark:disabled:text-zinc-500 dark:disabled:hover:bg-black"
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
    </>
  );
}
