"use client";

import { useMemo, useState } from "react";
import { formatCalendarDateShort, parseAsCalendarDate } from "@/lib/calendar-date";

type UserRole = "revisor" | "usuario";

export type TaskRow = {
  id: string;
  created_at: string | null;
  status: string | null;
  title: string | null;
  description?: string | null;
  due_at?: string | null;
  priority?: string | null;
  assigned_to_email?: string | null;
  revisor_id?: string | null;
  submission_name?: string | null;
  submission_path?: string | null;
  submitted_at?: string | null;
  submitted_by_email?: string | null;
};

function formatShortDate(value: string | null | undefined) {
  return formatCalendarDateShort(value);
}

function getPriorityTone(priority: string | null | undefined) {
  const normalized = (priority ?? "").trim().toLowerCase();
  if (normalized.includes("urg") || normalized.includes("alta")) {
    return "text-red-700 dark:text-red-300";
  }
  if (normalized.includes("med")) {
    return "text-amber-700 dark:text-amber-300";
  }
  return "text-emerald-700 dark:text-emerald-300";
}

function getStatusTone(status: string | null | undefined) {
  const normalized = (status ?? "").trim().toLowerCase();

  if (normalized.includes("comp") || normalized.includes("done")) {
    return "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:ring-emerald-900";
  }
  if (normalized.includes("prog") || normalized.includes("curso")) {
    return "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200 dark:bg-blue-950/30 dark:text-blue-200 dark:ring-blue-900";
  }
  return "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-900";
}

function getDueTone(value: string | null | undefined, status: string | null | undefined) {
  if (!value) return "text-zinc-500 dark:text-zinc-400";

  const normalizedStatus = (status ?? "").trim().toLowerCase();
  if (normalizedStatus.includes("comp") || normalizedStatus.includes("done")) {
    return "text-zinc-500 dark:text-zinc-400";
  }

  const due = parseAsCalendarDate(value);
  if (!due) return "text-zinc-500 dark:text-zinc-400";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);

  if (due.getTime() < today.getTime()) {
    return "text-red-600 dark:text-red-400";
  }

  return "text-zinc-700 dark:text-zinc-200";
}

function extractEntregaPathFromDescription(description: string | null | undefined) {
  if (!description) return null;
  const match = /^\s*entrega:\s*(\S+)\s*$/im.exec(description);
  return match?.[1] ?? null;
}

function extractEntregaMeta(description: string | null | undefined) {
  const text = description ?? "";
  const path = /^\s*entrega:\s*(\S+)\s*$/im.exec(text)?.[1] ?? null;
  const submittedBy = /^\s*entregado por:\s*(.+)\s*$/im.exec(text)?.[1]?.trim() ?? null;
  const submittedAt = /^\s*entregado el:\s*(.+)\s*$/im.exec(text)?.[1]?.trim() ?? null;

  return { path, submittedBy, submittedAt };
}

function getVisibleDescription(description: string | null | undefined) {
  const text = description ?? "";
  const cleaned = text
    .split(/\r?\n/)
    .filter((line) => {
      const normalized = line.trim().toLowerCase();
      return (
        !normalized.startsWith("entrega:") &&
        !normalized.startsWith("entregado por:") &&
        !normalized.startsWith("entregado el:")
      );
    })
    .join("\n")
    .trim();

  return cleaned || null;
}

function extractFileNameFromPath(path: string | null | undefined) {
  if (!path) return null;
  const lastSlash = path.lastIndexOf("/");
  const name = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  return name || null;
}

function getSubmissionDisplayName(
  submissionName: string | null | undefined,
  submissionPath: string | null | undefined,
  fallbackDescription: string | null | undefined
) {
  if (submissionName && submissionName.trim().length > 0) {
    return submissionName;
  }
  const fromPath = extractFileNameFromPath(submissionPath);
  if (fromPath) {
    return fromPath;
  }
  const meta = extractEntregaMeta(fallbackDescription);
  const fromMetaPath = extractFileNameFromPath(meta.path);
  return fromMetaPath ?? "Documento.pdf";
}

function hasDeliveryEvidence(t: TaskRow) {
  return Boolean(
    t.submission_path ||
      extractEntregaPathFromDescription(t.description) ||
      t.submission_name ||
      t.submitted_at ||
      t.submitted_by_email
  );
}

export function TaskBoard({
  role,
  currentUserId,
  tasks,
  onSubmit,
  downloadBasePath,
  onSaveComment,
  onDelete,
}: {
  role: UserRole;
  currentUserId: string;
  tasks: TaskRow[];
  onSubmit: (formData: FormData) => Promise<void | unknown>;
  downloadBasePath: string;
  onSaveComment: (formData: FormData) => Promise<void>;
  onDelete: (formData: FormData) => Promise<void>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  const selected = useMemo(() => {
    if (!openId) return null;
    return tasks.find((t) => t.id === openId) ?? null;
  }, [openId, tasks]);

  const deliveryMeta = extractEntregaMeta(selected?.description);
  const deliveryPath = selected?.submission_path ?? deliveryMeta.path;
  const selectedHasDelivery = selected ? hasDeliveryEvidence(selected) : false;
  const visibleDescription = getVisibleDescription(selected?.description);
  const submittedAtLabel = selected?.submitted_at ?? deliveryMeta.submittedAt;
  const submittedByLabel = selected?.submitted_by_email ?? deliveryMeta.submittedBy;
  const deliveryFileName = getSubmissionDisplayName(
    selected?.submission_name,
    selected?.submission_path,
    selected?.description
  );

  const isCompleted = (status: string | null | undefined) => {
    const normalized = (status ?? "").trim().toLowerCase();
    return normalized.includes("comp") || normalized.includes("done");
  };

  const resetModalState = () => {
  };

  return (
    <>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tasks.map((t) => {
          const canDelete =
            role === "revisor" &&
            t.revisor_id &&
            t.revisor_id === currentUserId;

          return (
            <div
              key={t.id}
              className="flex flex-col justify-between rounded-lg border border-zinc-200 bg-white text-left dark:border-zinc-800 dark:bg-zinc-950"
            >
              <button
                type="button"
                onClick={() => {
                  resetModalState();
                  setOpenId(t.id);
                }}
                className="w-full flex-1 p-5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
              >
                <div className="min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                        {t.title ?? "Sin título"}
                      </div>
                      {getVisibleDescription(t.description) && (
                        <div className="mt-2 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">
                          {getVisibleDescription(t.description)}
                        </div>
                      )}
                    </div>
                    <span
                      className={[
                        "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium",
                        getStatusTone(t.status),
                      ].join(" ")}
                    >
                      {t.status ?? "Pendiente"}
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                  <div className="flex items-center justify-between gap-3">
                    <span>Prioridad</span>
                    <span className={["font-medium", getPriorityTone(t.priority)].join(" ")}>
                      {t.priority ?? "Media"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Fecha límite</span>
                    <span className={["font-medium", getDueTone(t.due_at, t.status)].join(" ")}>
                      {formatShortDate(t.due_at)}
                    </span>
                  </div>
                  {hasDeliveryEvidence(t) && (
                    <div className="flex items-center justify-between gap-3">
                      <span>Archivo</span>
                      <span
                        className="max-w-[60%] truncate font-medium text-emerald-700 dark:text-emerald-300"
                        title={getSubmissionDisplayName(
                          t.submission_name,
                          t.submission_path,
                          t.description
                        )}
                      >
                        {getSubmissionDisplayName(
                          t.submission_name,
                          t.submission_path,
                          t.description
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </button>

              {canDelete && (
                <div className="border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
                  <form
                    action={onDelete}
                    onSubmit={(e) => {
                      e.stopPropagation();
                      const ok = window.confirm(
                        "¿Estás seguro de que deseas eliminar esta asignación? Esta acción no se puede deshacer."
                      );
                      if (!ok) e.preventDefault();
                    }}
                  >
                    <input type="hidden" name="assignment_id" value={t.id} />
                    <button
                      type="submit"
                      className="inline-flex h-9 w-full items-center justify-center rounded-md border border-red-200 bg-white px-3 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900/40 dark:bg-black dark:text-red-300 dark:hover:bg-red-950/40"
                    >
                      Eliminar
                    </button>
                  </form>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 md:items-center">
          <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-zinc-950 dark:text-zinc-50">
                  {selected.title ?? "Sin título"}
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                  <span
                    className={[
                      "inline-flex rounded-full px-2.5 py-1 font-medium",
                      getStatusTone(selected.status),
                    ].join(" ")}
                  >
                    {selected.status ?? "Pendiente"}
                  </span>
                  <span className={["inline-flex items-center font-medium", getPriorityTone(selected.priority)].join(" ")}>
                    {selected.priority ?? "Media"}
                  </span>
                  <span className={getDueTone(selected.due_at, selected.status)}>
                    Límite: {formatShortDate(selected.due_at)}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setOpenId(null)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-black dark:text-zinc-200 dark:hover:bg-zinc-900"
                aria-label="Cerrar"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                  className="h-4 w-4"
                >
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            <div className="grid gap-4 px-5 py-4">
              <div>
                <div className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                  Instrucciones
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                  {visibleDescription ?? "Sin instrucciones."}
                </div>
              </div>

              {role === "revisor" && (
                <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-black">
                  <div className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                    Estado de la tarea
                  </div>
                  <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                    {isCompleted(selected.status)
                      ? "Completada por el supervisor."
                      : "Aún pendiente de entrega."}
                  </div>
                </div>
              )}

              {role === "usuario" && (
                <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-black">
                  <div className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                    Estado de tu entrega
                  </div>
                  <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                    {selectedHasDelivery
                      ? "Tu PDF ya está guardado y el revisor puede revisarlo."
                      : "Aún no has subido una entrega para esta tarea."}
                  </div>
                </div>
              )}

              {selectedHasDelivery && (
                <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-black">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900">
                      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="h-5 w-5">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M14 2v6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M9 15h6M9 18h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div
                        className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50"
                        title={deliveryFileName}
                      >
                        {deliveryFileName}
                      </div>
                      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {submittedByLabel ? `Enviado por ${submittedByLabel}` : "Documento PDF"}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-zinc-600 dark:text-zinc-400">Fecha de entrega</span>
                      <span className="font-medium">
                        {formatShortDate(submittedAtLabel)}
                      </span>
                    </div>
                    <a
                      href={`${downloadBasePath}?assignment_id=${encodeURIComponent(selected.id)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="h-4 w-4">
                        <path d="M12 3v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        <path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                      Ver PDF
                    </a>
                  </div>
                </div>
              )}

              {role === "revisor" && (
                <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-black">
                  <div className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                    Comentario
                  </div>
                  <div className="mt-2 grid gap-3">
                    <form action={onSaveComment} className="grid gap-3">
                      <input
                        type="hidden"
                        name="assignment_id"
                        value={selected.id}
                      />
                      <textarea
                        name="comment"
                        rows={3}
                        required
                        placeholder="Escribe un comentario para el supervisor…"
                        className="resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
                      />
                      <button
                        type="submit"
                        className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                      >
                        Enviar comentario
                      </button>
                    </form>
                  </div>
                </div>
              )}

              {role === "usuario" && (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/30">
                  <div className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                    {selectedHasDelivery ? "Modificar entrega (PDF)" : "Subir archivo (PDF)"}
                  </div>
                  {selectedHasDelivery && (
                    <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                      La entrega actual sigue guardada. Si subes otro PDF, se reemplaza por la nueva versión.
                    </div>
                  )}
                  <form action={onSubmit} method="POST" encType="multipart/form-data" className="mt-3 grid gap-3">
                    <input type="hidden" name="assignment_id" value={selected.id} />
                    <input
                      name="file"
                      type="file"
                      accept="application/pdf,.pdf"
                      required
                      className="block w-full text-sm text-zinc-700 file:mr-4 file:rounded-md file:border file:border-zinc-200 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-zinc-900 hover:file:bg-zinc-100 dark:text-zinc-300 dark:file:border-zinc-800 dark:file:bg-black dark:file:text-zinc-100 dark:hover:file:bg-zinc-900"
                    />
                    <button
                      type="submit"
                      className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                      {selectedHasDelivery || isCompleted(selected.status)
                        ? "Actualizar entrega"
                        : "Enviar entrega"}
                    </button>
                  </form>
                </div>
              )}

              {role === "revisor" &&
                selected.revisor_id &&
                selected.revisor_id === currentUserId && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/40 dark:bg-red-950/30">
                    <div className="text-sm font-medium text-red-900 dark:text-red-100">
                      Zona de peligro
                    </div>
                    <div className="mt-1 text-sm text-red-800 dark:text-red-200">
                      Elimina esta asignación y su adjunto de forma permanente.
                    </div>
                    <form
                      action={onDelete}
                      onSubmit={(e) => {
                        const ok = window.confirm(
                          "¿Estás seguro de que deseas eliminar esta asignación? Esta acción no se puede deshacer."
                        );
                        if (!ok) e.preventDefault();
                      }}
                      className="mt-3"
                    >
                      <input
                        type="hidden"
                        name="assignment_id"
                        value={selected.id}
                      />
                      <button
                        type="submit"
                        className="inline-flex h-10 w-full items-center justify-center rounded-md border border-red-200 bg-white px-4 text-sm font-medium text-red-700 hover:bg-red-100 dark:border-red-900/40 dark:bg-black dark:text-red-300 dark:hover:bg-red-950/40"
                      >
                        Eliminar asignación
                      </button>
                    </form>
                  </div>
                )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
