import { PlatformShell } from "@/app/platform/platform-shell";
import type { SidebarSection } from "@/app/platform/components/sidebar";
import { TaskBoard, type TaskRow } from "@/app/platform/task/task-board";
import type { UserRole } from "@/lib/platform-roles";
import type { PostgrestError } from "@supabase/supabase-js";

type TaskRowWithRevisor = TaskRow & { revisor_id?: string | null };

type Props = {
  role: UserRole;
  currentUserId: string;
  currentUserEmail?: string;
  sections: SidebarSection[];
  statusFilter: string;
  dateFrom?: string;
  dateTo?: string;
  supervisorFilter?: string;
  userOptions?: { value: string; label: string }[];
  error: PostgrestError | null;
  errorParam?: string;
  messageParam?: string;
  assignments: TaskRowWithRevisor[];
  basePath: string;
  onSubmit: (formData: FormData) => any;
  downloadBasePath: string;
  onSaveComment: (formData: FormData) => Promise<void>;
  onDelete: (formData: FormData) => Promise<void>;
};

function filterClass(statusFilter: string, key: string, _value: string) {
  const active =
    key === "all"
      ? !statusFilter || statusFilter === "all"
      : statusFilter?.includes(key);
  return [
    "rounded-full px-3 py-1.5",
    active
      ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
      : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
  ].join(" ");
}

function buildQuery(entries: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(entries)) {
    if (v && String(v).trim().length > 0) params.set(k, v);
  }
  const q = params.toString();
  return q ? `?${q}` : "";
}

export function TaskPageContent({
  role,
  currentUserId,
  currentUserEmail,
  sections,
  statusFilter,
  dateFrom,
  dateTo,
  supervisorFilter,
  userOptions = [],
  error,
  errorParam,
  messageParam,
  assignments,
  basePath,
  onSubmit,
  downloadBasePath,
  onSaveComment,
  onDelete,
}: Props) {
  const preserve: Record<string, string | undefined> = {
    status: statusFilter && statusFilter !== "all" ? statusFilter : undefined,
    date_from: dateFrom,
    date_to: dateTo,
    supervisor: supervisorFilter,
  };

  const linkForStatus = (status: string) => {
    return `${basePath}${buildQuery({
      ...preserve,
      status: status === "all" ? undefined : status,
    })}`;
  };

  const clearLink = `${basePath}?status=all`;

  return (
    <PlatformShell
      sections={sections}
      currentUserId={currentUserId}
      currentUserEmail={currentUserEmail}
    >
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              Task
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Actividades asignadas en una vista de tarjetas.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <a href={linkForStatus("all")} className={filterClass(statusFilter, "all", "all")}>
              Todas
            </a>
            <a href={linkForStatus("pending")} className={filterClass(statusFilter, "pend", "pending")}>
              Pendientes
            </a>
            <a href={linkForStatus("progress")} className={filterClass(statusFilter, "prog", "progress")}>
              En curso
            </a>
            <a href={linkForStatus("completed")} className={filterClass(statusFilter, "comp", "completed")}>
              Completadas
            </a>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <form
            method="GET"
            action={basePath}
            className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_1.3fr_auto_auto]"
          >
            <input type="hidden" name="status" value={statusFilter ?? "all"} />

            <label className="grid gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Desde</span>
              <input
                type="date"
                name="date_from"
                defaultValue={dateFrom ?? ""}
                className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-50"
              />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Hasta</span>
              <input
                type="date"
                name="date_to"
                defaultValue={dateTo ?? ""}
                className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-50"
              />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">
                Supervisor
              </span>
              <select
                name="supervisor"
                defaultValue={supervisorFilter ?? ""}
                className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-50"
              >
                <option value="">Todos los usuarios</option>
                {userOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-end">
              <button
                type="submit"
                className="h-10 w-full rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Filtrar
              </button>
            </div>

            <div className="flex items-end">
              <a
                href={clearLink}
                className="inline-flex h-10 w-full items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-black dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Limpiar
              </a>
            </div>
          </form>
        </div>

        {(errorParam || messageParam) && (
          <div
            className={[
              "mt-4 rounded-lg border p-4 text-sm",
              errorParam
                ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100"
                : "border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-100",
            ].join(" ")}
          >
            {errorParam ?? messageParam}
          </div>
        )}

        <div className="mt-4 rounded-lg border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
            {assignments.length} actividades
          </div>
          <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {role === "usuario"
              ? "Asignadas a tu correo."
              : "Todas las actividades del sistema."}
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
            {error.message}
          </div>
        )}

        {!error && assignments.length === 0 && (
          <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            No hay actividades para los filtros seleccionados.
          </div>
        )}

        {!error && assignments.length > 0 && (
          <TaskBoard
            role={role}
            currentUserId={currentUserId}
            tasks={assignments}
            onSubmit={onSubmit}
            downloadBasePath={downloadBasePath}
            onSaveComment={onSaveComment}
            onDelete={onDelete}
          />
        )}
      </div>
    </PlatformShell>
  );
}
