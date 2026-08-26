"use client";

type Props = {
  assignmentId: string;
  formAction: (formData: FormData) => Promise<void>;
};

export function DeleteAssignmentForm({ assignmentId, formAction }: Props) {
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const ok = window.confirm(
          "¿Estás seguro de que deseas eliminar esta asignación? Esta acción no se puede deshacer."
        );
        if (!ok) e.preventDefault();
      }}
    >
      <input type="hidden" name="assignment_id" value={assignmentId} />
      <button
        type="submit"
        className="inline-flex h-9 items-center justify-center rounded-md border border-red-200 bg-white px-3 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900/40 dark:bg-black dark:text-red-300 dark:hover:bg-red-950/40"
      >
        Eliminar
      </button>
    </form>
  );
}
