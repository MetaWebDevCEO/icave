"use client";

import { useMemo, useState } from "react";

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
  submission_name?: string | null;
  submission_path?: string | null;
  submitted_at?: string | null;
  submitted_by_email?: string | null;
};

function formatShortDate(value: string | null | undefined) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(date);
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

  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return "text-zinc-500 dark:text-zinc-400";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);

  if (due.getTime() < today.getTime()) {
    return "text-red-600 dark:text-red-400";
  }

  return "text-zinc-700 dark:text-zinc-200";
}

export function TaskBoard({
  role,
  tasks,
  onSubmit,
  onDownload,
  onGetPreviewUrl,
  onSaveComment,
}: {
  role: UserRole;
  tasks: TaskRow[];
  onSubmit: (formData: FormData) => Promise<void>;
  onDownload: (formData: FormData) => Promise<void>;
  onGetPreviewUrl: (formData: FormData) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
  onSaveComment: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [commentOk, setCommentOk] = useState(false);

  const selected = useMemo(() => {
    if (!openId) return null;
    return tasks.find((t) => t.id === openId) ?? null;
  }, [openId, tasks]);

  const isCompleted = (status: string | null | undefined) => {
    const normalized = (status ?? "").trim().toLowerCase();
    return normalized.includes("comp") || normalized.includes("done");
  };

  const resetModalState = () => {
    setPreviewUrl(null);
    setPreviewError(null);
    setCommentError(null);
    setCommentOk(false);
    setCommentText("");
  };

  return (
    <>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tasks.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              resetModalState();
              setOpenId(t.id);
            }}
            className="flex flex-col justify-between rounded-lg border border-zinc-200 bg-white p-5 text-left transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/60"
          >
            <div className="min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                    {t.title ?? "Sin título"}
                  </div>
                  {t.description && (
                    <div className="mt-2 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">
                      {t.description}
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
            </div>
          </button>
        ))}
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
                  {selected.description ?? "Sin instrucciones."}
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

              {selected.submission_path && (
                <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-black">
                  <div className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                    Entrega
                  </div>
                  <div className="mt-2 grid gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-zinc-600 dark:text-zinc-400">Archivo</span>
                      <span className="font-medium">
                        {selected.submission_name ?? "PDF"}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-zinc-600 dark:text-zinc-400">Enviado</span>
                      <span className="font-medium">
                        {formatShortDate(selected.submitted_at)}
                      </span>
                    </div>
                    {selected.submitted_by_email && (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-zinc-600 dark:text-zinc-400">Por</span>
                        <span className="font-medium">{selected.submitted_by_email}</span>
                      </div>
                    )}
                    <form action={onDownload}>
                      <input
                        type="hidden"
                        name="assignment_id"
                        value={selected.id}
                      />
                      <button
                        type="submit"
                        className="mt-1 inline-flex h-10 w-full items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:hover:bg-zinc-900"
                      >
                        Descargar PDF
                      </button>
                    </form>

                    {role === "revisor" && (
                      <div className="mt-2 grid gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            setPreviewError(null);
                            setPreviewUrl(null);
                            const fd = new FormData();
                            fd.set("assignment_id", selected.id);
                            const result = await onGetPreviewUrl(fd);
                            if (!result.ok) {
                              setPreviewError(result.error);
                              return;
                            }
                            setPreviewUrl(result.url);
                          }}
                          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                        >
                          Ver PDF
                        </button>
                        {previewError && (
                          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100">
                            {previewError}
                          </div>
                        )}
                        {previewUrl && (
                          <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
                            <iframe
                              title="Vista previa PDF"
                              src={previewUrl}
                              className="h-[520px] w-full bg-white"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {role === "revisor" && (
                <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-black">
                  <div className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                    Comentario
                  </div>
                  <div className="mt-2 grid gap-3">
                    <textarea
                      value={commentText}
                      onChange={(e) => {
                        setCommentText(e.target.value);
                        setCommentError(null);
                        setCommentOk(false);
                      }}
                      rows={3}
                      placeholder="Escribe un comentario para el supervisor…"
                      className="resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        setCommentError(null);
                        setCommentOk(false);
                        const text = commentText.trim();
                        if (!text) {
                          setCommentError("Escribe un comentario antes de enviar.");
                          return;
                        }
                        const fd = new FormData();
                        fd.set("assignment_id", selected.id);
                        fd.set("comment", text);
                        const result = await onSaveComment(fd);
                        if (!result.ok) {
                          setCommentError(result.error);
                          return;
                        }
                        setCommentOk(true);
                      }}
                      className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                      Enviar comentario
                    </button>
                    {commentError && (
                      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100">
                        {commentError}
                      </div>
                    )}
                    {commentOk && (
                      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-100">
                        Comentario enviado.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {role === "usuario" && (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/30">
                  <div className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                    Subir archivo (PDF)
                  </div>
                  {selected.submission_path && (
                    <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                      Ya existe una entrega. Puedes reemplazarla subiendo un nuevo PDF.
                    </div>
                  )}
                  <form action={onSubmit} className="mt-3 grid gap-3">
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
                      {selected.submission_path || isCompleted(selected.status)
                        ? "Actualizar entrega"
                        : "Enviar entrega"}
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
