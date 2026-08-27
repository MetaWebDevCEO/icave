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
  error: PostgrestError | null;
  errorParam?: string;
  messageParam?: string;
  assignments: TaskRowWithRevisor[];
  basePath: string;
  onSubmit: (formData: FormData) => Promise<void | unknown>;
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

export function TaskPageContent({
  role,
  currentUserId,
  currentUserEmail,
  sections,
  statusFilter,
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
  const link = (status: string) =>
    status === "all"
      ? `${basePath}?status=all`
      : `${basePath}?status=${status}`;

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
            <a href={link("all")} className={filterClass(statusFilter, "all", "all")}>
              Todas
            </a>
            <a href={link("pending")} className={filterClass(statusFilter, "pend", "pending")}>
              Pendientes
            </a>
            <a href={link("progress")} className={filterClass(statusFilter, "prog", "progress")}>
              En curso
            </a>
            <a href={link("completed")} className={filterClass(statusFilter, "comp", "completed")}>
              Completadas
            </a>
          </div>
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
