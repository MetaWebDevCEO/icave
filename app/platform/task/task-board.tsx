"use client";

import { useMemo, useRef, useState } from "react";
import { formatCalendarDateShort, parseAsCalendarDate } from "@/lib/calendar-date";
import {
  maxEvidenceFiles,
  maxSubmissionSizeBytes,
  parseSubmissionFiles,
  type SubmissionFile,
} from "@/lib/submission-files";
import { FileText as DocumentIcon } from "@/components/ui/icons";

const MAX_SUBMISSION_SIZE_BYTES = maxSubmissionSizeBytes();
const MAX_EVIDENCE_FILES = maxEvidenceFiles();

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
  submission_mime?: string | null;
  submission_files?: unknown;
  submitted_at?: string | null;
  submitted_by_email?: string | null;
};

function formatShortDate(value: string | null | undefined) {
  return formatCalendarDateShort(value);
}

function getPriorityTone(priority: string | null | undefined) {
  const normalized = (priority ?? "").trim().toLowerCase();
  const hasNoUrgente =
    normalized.includes("no urg") ||
    normalized.startsWith("no urg") ||
    normalized.includes("baja") ||
    normalized.includes("bajo") ||
    normalized === "low" ||
    normalized === "3";
  if (!hasNoUrgente && (normalized.includes("urg") || normalized.includes("alta") || normalized.includes("high") || normalized === "1")) {
    return "text-red-700 dark:text-red-300";
  }
  if (normalized.includes("med") || normalized === "medium" || normalized === "2") {
    return "text-amber-700 dark:text-amber-300";
  }
  return "text-emerald-700 dark:text-emerald-300";
}

function getStatusTone(status: string | null | undefined) {
  const normalized = (status ?? "").trim().toLowerCase();

  if (normalized.includes("comp") || normalized.includes("done")) {
    return "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:ring-emerald-900";
  }
  if (normalized.includes("entreg")) {
    return "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200 dark:bg-violet-950/30 dark:text-violet-200 dark:ring-violet-900";
  }
  if (normalized.includes("prog") || normalized.includes("curso")) {
    return "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200 dark:bg-blue-950/30 dark:text-blue-200 dark:ring-blue-900";
  }
  return "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-900";
}

function getDueTone(value: string | null | undefined, status: string | null | undefined) {
  if (!value) return "text-zinc-500 dark:text-zinc-400";

  const normalizedStatus = (status ?? "").trim().toLowerCase();
  if (normalizedStatus.includes("comp") || normalizedStatus.includes("done") || normalizedStatus.includes("termin") || normalizedStatus.includes("final") || normalizedStatus.includes("cerrad") || normalizedStatus.includes("entreg")) {
    return "text-zinc-500 dark:text-zinc-400";
  }

  const due = parseAsCalendarDate(value);
  if (!due) return "text-zinc-500 dark:text-zinc-400";

  // Comparación en UTC (alineada con formatCalendarDateShort).
  const now = new Date();
  const todayUtcMidnight = Date.UTC(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0
  );

  const dueUtcMidnight = Date.UTC(
    due.getUTCFullYear(),
    due.getUTCMonth(),
    due.getUTCDate(),
    0,
    0,
    0,
    0
  );

  if (dueUtcMidnight < todayUtcMidnight) {
    return "text-red-600 dark:text-red-400";
  }

  return "text-zinc-700 dark:text-zinc-200";
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
        !normalized.startsWith("entregado el:") &&
        !normalized.startsWith("enviado por:") &&
        !normalized.startsWith("enviado el:") &&
        !normalized.startsWith("evidencia")
      );
    })
    .join("\n")
    .trim();

  return cleaned || null;
}

function hasDeliveryEvidence(t: TaskRow) {
  const files = parseSubmissionFiles(t);
  if (files.length > 0) return true;
  return Boolean(t.submitted_at || t.submitted_by_email);
}

export function TaskBoard({
  role,
  currentUserId,
  tasks,
  onSubmit,
  downloadBasePath,
  onSaveComment,
  onDelete,
  onDeleteEvidence,
  onMarkCompleted,
}: {
  role: UserRole;
  currentUserId: string;
  tasks: TaskRow[];
  onSubmit: (formData: FormData) => Promise<void>;
  downloadBasePath: string;
  onSaveComment: (formData: FormData) => Promise<void>;
  onDelete: (formData: FormData) => Promise<void>;
  onDeleteEvidence?: (formData: FormData) => Promise<void>;
  onMarkCompleted?: (formData: FormData) => Promise<void>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [submissionSizeError, setSubmissionSizeError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(() => {
    if (!openId) return null;
    return tasks.find((t) => t.id === openId) ?? null;
  }, [openId, tasks]);

  const deliveryFiles: SubmissionFile[] = selected
    ? parseSubmissionFiles(selected)
    : [];
  const deliveryMeta = extractEntregaMeta(selected?.description);
  const selectedHasDelivery =
    (selected ? hasDeliveryEvidence(selected) : false) ||
    deliveryFiles.length > 0;
  const visibleDescription = getVisibleDescription(selected?.description);
  const submittedAtLabel = selected?.submitted_at ?? deliveryMeta.submittedAt;
  const submittedByLabel = selected?.submitted_by_email ?? deliveryMeta.submittedBy;

  const isCompleted = (status: string | null | undefined) => {
    const normalized = (status ?? "").trim().toLowerCase();
    return normalized.includes("comp") || normalized.includes("done");
  };

  const resetModalState = () => {
    setSubmissionSizeError(null);
    setSelectedFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const removeSelectedFile = (index: number) => {
    setSelectedFiles((prev) => {
      const next = prev.filter((_, i) => i !== index);
      // Sincronizar el input file real
      if (fileInputRef.current) {
        const dt = new DataTransfer();
        next.forEach((f) => dt.items.add(f));
        fileInputRef.current.files = dt.files;
      }
      if (next.length === 0) {
        setSubmissionSizeError(null);
      }
      return next;
    });
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
                      {t.priority ?? "Medio"}
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
                      <span>
                        Evidencia{parseSubmissionFiles(t).length !== 1 ? "s" : ""}
                      </span>
                      <span
                        className="max-w-[60%] truncate font-medium text-emerald-700 dark:text-emerald-300"
                        title={parseSubmissionFiles(t)
                          .map((f) => f.name)
                          .join(", ")}
                      >
                        {parseSubmissionFiles(t).length > 0
                          ? `${parseSubmissionFiles(t).length} archivo${parseSubmissionFiles(t).length !== 1 ? "s" : ""}`
                          : "PDF adjunto"}
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
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
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

            <div className="grid gap-3 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                  Instrucciones
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                  {visibleDescription ?? "Sin instrucciones."}
                </div>
              </div>

              {role === "revisor" && (
                <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-black">
                  <div className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                    Estado de la tarea
                  </div>
                  {onMarkCompleted &&
                    selectedHasDelivery &&
                    !isCompleted(selected.status) ? (
                      <form action={onMarkCompleted} className="mt-3">
                        <input
                          type="hidden"
                          name="assignment_id"
                          value={selected.id}
                        />
                        <button
                          type="submit"
                          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
                        >
                          Marcar como completada
                        </button>
                      </form>
                    ) : (
                      <div className="mt-1.5 text-sm text-zinc-700 dark:text-zinc-300">
                        {isCompleted(selected.status)
                          ? "Completada por el supervisor."
                          : selectedHasDelivery
                            ? "Entregada — pendiente de tu aprobación."
                            : "Aún pendiente de entrega."}
                      </div>
                    )}
                </div>
              )}

              {role === "usuario" && (
                <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-black">
                  <div className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                    Estado de tu entrega
                  </div>
                  <div className="mt-1.5 text-sm text-zinc-700 dark:text-zinc-300">
                    {selectedHasDelivery
                      ? "Tu PDF ya está guardado y el revisor puede revisarlo."
                      : "Aún no has subido una entrega para esta tarea."}
                  </div>
                </div>
              )}

              {selectedHasDelivery && (
                <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-black">
                  <div className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                    Evidencia de cumplimiento
                  </div>
                  <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {submittedByLabel ? `Enviado por ${submittedByLabel}` : "Documento PDF"}
                    {submittedAtLabel
                      ? ` · ${formatShortDate(submittedAtLabel)}`
                      : ""}
                  </div>

                  {deliveryFiles.length > 0 && (
                    <div className="mt-3 grid gap-1.5">
                      {deliveryFiles.map((f, idx) => (
                        <div
                          key={`${f.path}-${idx}`}
                          className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40"
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900">
                              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="h-4 w-4">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M14 2v6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M9 15h6M9 18h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                              </svg>
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-xs font-medium text-zinc-950 dark:text-zinc-50">
                                {f.name}
                              </div>
                              <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                                Evidencia {idx + 1} · PDF
                              </div>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <a
                              href={`${downloadBasePath}?assignment_id=${encodeURIComponent(selected!.id)}&idx=${encodeURIComponent(String(idx))}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Ver"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                            >
                              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="h-3.5 w-3.5">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                              </svg>
                            </a>
                            <a
                              href={`${downloadBasePath}?assignment_id=${encodeURIComponent(selected!.id)}&idx=${encodeURIComponent(String(idx))}&disposition=attachment`}
                              title="Descargar"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                            >
                              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="h-3.5 w-3.5">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                <polyline points="7 10 12 15 17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                <line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </a>
                            {role === "usuario" && (
                              <form action={onDeleteEvidence} className="inline">
                                <input type="hidden" name="assignment_id" value={selected!.id} />
                                <input type="hidden" name="file_path" value={f.path} />
                                <button
                                  type="submit"
                                  title="Eliminar"
                                  onClick={(e) => {
                                    if (!window.confirm(`¿Eliminar el archivo "${f.name}"?`)) {
                                      e.preventDefault();
                                    }
                                  }}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-red-200 bg-white text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:bg-zinc-900 dark:text-red-300 dark:hover:bg-red-950/40"
                                >
                                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="h-3.5 w-3.5">
                                    <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                </button>
                              </form>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
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
                  <section>
                    {deliveryFiles.length < MAX_EVIDENCE_FILES && (
                    <>
                    <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                      Subir evidencias
                    </h3>
                    <div className="mt-2 rounded-2xl border border-zinc-100 bg-zinc-50/60 p-3 dark:border-zinc-900 dark:bg-zinc-900/30">
                      <form action={onSubmit} className="grid gap-3">
                        <input
                          type="hidden"
                          name="assignment_id"
                          value={selected.id}
                        />
                        <div className="grid gap-2">
                          <label className="group relative block cursor-pointer rounded-2xl border-2 border-dashed border-zinc-300 bg-white px-4 py-6 text-center transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/40">
                            <input
                              ref={fileInputRef}
                              name="files"
                              type="file"
                              accept="application/pdf,.pdf"
                              multiple
                              required
                              onChange={(e) => {
                                const fileList = e.target.files;
                                const files = fileList
                                  ? Array.from(fileList)
                                  : [];
                                const remaining = MAX_EVIDENCE_FILES - deliveryFiles.length;
                                if (files.length > remaining) {
                                  setSelectedFiles([]);
                                  setSubmissionSizeError(
                                    `Solo puedes subir ${remaining} archivo${remaining === 1 ? "" : "s"} más (ya tienes ${deliveryFiles.length} de ${MAX_EVIDENCE_FILES}).`
                                  );
                                  return;
                                }
                                const tooBig = files.find(
                                  (f) => f.size > MAX_SUBMISSION_SIZE_BYTES
                                );
                                if (tooBig) {
                                  setSelectedFiles([]);
                                  setSubmissionSizeError(
                                    `El archivo ${tooBig.name} supera los 10 MB. Reduce su tamaño.`
                                  );
                                  return;
                                }
                                const badMime = files.find((f) => {
                                  const n = (f.name || "").toLowerCase();
                                  const t = (f.type || "").toLowerCase();
                                  return (
                                    !n.endsWith(".pdf") &&
                                    !t.includes("pdf") &&
                                    t !== "application/octet-stream"
                                  );
                                });
                                if (badMime) {
                                  setSelectedFiles([]);
                                  setSubmissionSizeError(
                                    `El archivo "${badMime.name}" no es un PDF. Selecciona solo archivos .pdf.`
                                  );
                                  return;
                                }
                                setSelectedFiles(files);
                                setSubmissionSizeError(null);
                              }}
                              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                            />
                            <DocumentIcon className="mx-auto h-7 w-7 text-zinc-400 group-hover:text-zinc-600 dark:text-zinc-500 dark:group-hover:text-zinc-300" />
                            <p className="mt-3 text-sm font-medium text-zinc-800 dark:text-zinc-100">
                              Haz clic para seleccionar los PDFs
                            </p>
                            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                              PDF · {MAX_EVIDENCE_FILES - deliveryFiles.length} de {MAX_EVIDENCE_FILES} espacios · 10 MB
                              máximo cada uno
                            </p>
                          </label>

                          {submissionSizeError && (
                            <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 ring-1 ring-inset ring-red-100 dark:bg-red-950/30 dark:text-red-200 dark:ring-red-900/40">
                              {submissionSizeError}
                            </p>
                          )}

                          {selectedFiles.length > 0 && (
                            <ul className="mt-2 grid gap-2">
                              {selectedFiles.map((file, idx) => (
                                <li
                                  key={`${file.name}-${file.size}-${idx}`}
                                  className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"
                                >
                                  <div className="flex min-w-0 items-center gap-3">
                                    <DocumentIcon className="h-5 w-5 shrink-0 text-zinc-500 dark:text-zinc-400" />
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                        {file.name}
                                      </p>
                                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                        {formatFileSize(file.size)}
                                      </p>
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => removeSelectedFile(idx)}
                                    className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
                                  >
                                    Quitar
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <button
                          type="submit"
                          disabled={Boolean(submissionSizeError) || selectedFiles.length === 0}
                          className={[
                            "inline-flex h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold text-white shadow-sm transition-colors",
                            submissionSizeError || selectedFiles.length === 0
                              ? "cursor-not-allowed bg-zinc-400 hover:bg-zinc-400 dark:bg-zinc-700 dark:hover:bg-zinc-700"
                              : "bg-zinc-950 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white",
                          ].join(" ")}
                        >
                          {selectedHasDelivery || isCompleted(selected.status)
                            ? "Actualizar entrega"
                            : "Enviar entrega"}
                        </button>
                      </form>
                    </div>
                    </>
                    )}
                  </section>
                )}

                {role === "revisor" &&
                  selected.revisor_id &&
                  selected.revisor_id === currentUserId && (
                    <section>
                      <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-red-600 dark:text-red-400">
                        Zona de peligro
                      </h3>
                      <div className="mt-3 rounded-2xl border border-red-200 bg-red-50/60 p-5 dark:border-red-900/40 dark:bg-red-950/20">
                        <p className="text-sm font-semibold text-red-900 dark:text-red-100">
                          Eliminar asignación
                        </p>
                        <p className="mt-1 text-sm text-red-800/90 dark:text-red-200/90">
                          Elimina esta actividad y su evidencia de forma
                          permanente. No se puede deshacer.
                        </p>
                        <form
                          action={onDelete}
                          onSubmit={(e) => {
                            const ok = window.confirm(
                              "¿Estás seguro de que deseas eliminar esta asignación? Esta acción no se puede deshacer."
                            );
                            if (!ok) e.preventDefault();
                          }}
                          className="mt-4"
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
                    </section>
                  )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
