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
  priorityFilter?: string;
  dateFrom?: string;
  dateTo?: string;
  supervisorFilter?: string;
  userOptions?: { value: string; label: string }[];
  error: PostgrestError | null;
  assignments: TaskRowWithRevisor[];
  basePath: string;
  onSubmit: (formData: FormData) => Promise<void>;
  downloadBasePath: string;
  onSaveComment: (formData: FormData) => Promise<void>;
  onDelete: (formData: FormData) => Promise<void>;
  onDeleteEvidence?: (formData: FormData) => Promise<void>;
  onMarkCompleted?: (formData: FormData) => Promise<void>;
};

export function TaskPageContent({
  role,
  currentUserId,
  currentUserEmail,
  sections,
  statusFilter,
  priorityFilter = "all",
  dateFrom,
  dateTo,
  supervisorFilter,
  userOptions = [],
  error,
  assignments,
  basePath,
  onSubmit,
  downloadBasePath,
  onSaveComment,
  onDelete,
  onDeleteEvidence,
  onMarkCompleted,
}: Props) {
  const clearLink = `${basePath}?status=all&priority=all`;

  return (
    <PlatformShell
      sections={sections}
      currentUserId={currentUserId}
      currentUserEmail={currentUserEmail}
    >
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              Task
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Actividades asignadas en una vista de tarjetas.
            </p>
          </div>

          {/* Filtros: Mes, Prioridad, Estado */}
          <form
            method="GET"
            action={basePath}
            className="flex flex-wrap items-end gap-3"
          >
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Mes</span>
              <select
                name="month"
                defaultValue={dateFrom && dateTo ? dateFrom.slice(0, 7) : ""}
                className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-50"
              >
                <option value="">Todos los meses</option>
                {Array.from({ length: 12 }).map((_, i) => {
                  const d = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - i, 1));
                  const value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
                  return (
                    <option key={value} value={value}>
                      {d.toLocaleDateString("es-MX", { month: "long", year: "numeric", timeZone: "UTC" })}
                    </option>
                  );
                })}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Prioridad</span>
              <select
                name="priority"
                defaultValue={priorityFilter ?? "all"}
                className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-50"
              >
                <option value="all">Todas</option>
                <option value="urgent">Urgente</option>
                <option value="medium">Medio</option>
                <option value="low">No Urgente</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Estado</span>
              <select
                name="status"
                defaultValue={statusFilter ?? "all"}
                className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-50"
              >
                <option value="all">Todas</option>
                <option value="pending">Pendientes</option>
                <option value="progress">En curso</option>
                <option value="completed">Completadas</option>
              </select>
            </label>

            {role === "revisor" && (
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-zinc-600 dark:text-zinc-400">Supervisor</span>
                <select
                  name="supervisor"
                  defaultValue={supervisorFilter ?? ""}
                  className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-50"
                >
                  <option value="">Todos los usuarios</option>
                  {userOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <button
              type="submit"
              className="h-9 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Filtrar
            </button>

            <a
              href={clearLink}
              className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-black dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Limpiar
            </a>
          </form>
        </div>

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
            onDeleteEvidence={onDeleteEvidence}
            onMarkCompleted={onMarkCompleted}
          />
        )}
      </div>
    </PlatformShell>
  );
}
