"use client";

import * as React from "react";
import { createAssignment, type CreateAssignmentResult } from "@/app/platform/revisor/asignacion/actions";

export type MatrizOption = { id: number; actividad: string };
export type SupervisorOption = {
  id: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  userId?: string;
};

export type ModalMode =
  | { kind: "nueva" }
  | { kind: "fila"; actividad: MatrizOption }
  | { kind: "multiples"; actividades: MatrizOption[] };

function toISOAtMidnight(input: Date | string): string {
  try {
    const raw = typeof input === "string" ? input.trim() : input.toISOString();
    if (!raw) return new Date().toISOString();

    const mOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (mOnly) {
      return `${mOnly[1]}-${mOnly[2]}-${mOnly[3]}T00:00:00.000Z`;
    }

    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}T00:00:00.000Z`;
  } catch {
    return typeof input === "string" ? input : input.toISOString();
  }
}

/**
 * Último día del mes en curso (zona local del navegador).
 * Truco new Date(year, mesSiguiente, 0) = día 0 del mes que viene,
 * que es el último día del mes actual. setHours(0,0,0,0) por pureza.
 */
function ultimoDiaMesEnCurso(): Date {
  const ahora = new Date();
  const d = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Dado un valor de input tipo "date" (YYYY-MM-DD, SIN hora, SIN zona),
 * genera un ISO-8601 que, al ser parseado en cualquier servidor TZ,
 * NUNCA cambia el número del día. Truco: usamos 12:00:00 UTC (mediodía).
 *
 * Con 12h UTC:
 *   UTC−12  → 00:00 del MISMO día (no pasa a ayer)
 *   UTC+14  → 02:00 del DÍA SIGUIENTE (no pasa a mañana)
 * Dentro de zonas habitadas [UTC−12, UTC+14], el día sigue siendo el mismo.
 */
function dateInputToUTCNoon(dateStr: string): string {
  const s = String(dateStr ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    // Valor corrupto: volvemos al último día del mes por seguridad.
    const d = ultimoDiaMesEnCurso();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}T12:00:00.000Z`;
  }
  return `${s}T12:00:00.000Z`;
}

/**
 * Convertimos Date (locales del navegador) al YYYY-MM-DD que VIO el usuario
 * en el input (no el UTC de toISOString). toISOString() despieza TZ.
 * Ej: usuario en Madrid (UTC+2) 00:30 del 30 sep local
 *   new Date().toISOString() = 29 sep 22:30 UTC → slice = 29 (ERROR)
 *   getFullYear/getMonth/getDate = 30 (BIEN)
 */
function localDateToInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function initialsOf(input: string | null | undefined): string {
  if (!input) return "?";
  const trimmed = input.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/[\s.@-]+/).filter(Boolean);
  if (parts.length === 0) return trimmed[0]?.toUpperCase() ?? "?";
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : ""))
    .toUpperCase()
    .slice(0, 2);
}

function humanDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export type QuickAsignarFilaProps = {
  open: boolean;
  onClose: () => void;
  currentUserEmail: string | undefined;
  currentUserId: string;
  mode: ModalMode;
  matrizOptions: MatrizOption[];
  supervisores: SupervisorOption[];
  onCreated?: (result: { ok: true; ids: string[]; count: number }) => void;
  /**
   * Modo selección rápida: no se crea asignación, solo se elige un supervisor
   * para asociarlo a la fila indicada. Al confirmar se llama este callback.
   */
  selectionOnly?: { displayId: number };
  onSupervisorSelected?: (payload: {
    displayId: number;
    supervisor: SupervisorOption;
  }) => Promise<void> | void;
};

export function QuickAsignarFila(props: QuickAsignarFilaProps) {
  const {
    open,
    onClose,
    currentUserEmail,
    currentUserId,
    mode,
    matrizOptions,
    supervisores,
    onCreated,
    onSupervisorSelected,
  } = props;

  const isNueva = mode.kind === "nueva";
  const isMulti = mode.kind === "multiples";
  const isFilaRapida = mode.kind === "fila";
  const isSelectionOnly = Boolean(props.selectionOnly);
  const selectionDisplayId = props.selectionOnly?.displayId ?? null;

  const [supervisorEmail, setSupervisorEmail] = React.useState<string>("");
  const [fechaEntrega, setFechaEntrega] = React.useState<string>("");
  const [prioridad, setPrioridad] = React.useState<"alto" | "medio" | "bajo">("medio");
  const [descripcion, setDescripcion] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState<boolean>(false);
  const [result, setResult] = React.useState<CreateAssignmentResult | { ok: true; id: "" } | null>(
    null
  );

  // Progress for multiples
  const [progressCurrent, setProgressCurrent] = React.useState<number>(0);
  const [progressTotal, setProgressTotal] = React.useState<number>(0);
  const [multiIds, setMultiIds] = React.useState<string[]>([]);
  const [multiErrors, setMultiErrors] = React.useState<string[]>([]);

  // Estado SÓLO para modo "nueva"
  const [tituloLibre, setTituloLibre] = React.useState<string>("");

  React.useEffect(() => {
    if (open) {
      setSupervisorEmail("");
      setPrioridad("medio");
      setDescripcion("");
      setResult(null);
      setProgressCurrent(0);
      setProgressTotal(0);
      setMultiIds([]);
      setMultiErrors([]);
      setTituloLibre("");
      const def = ultimoDiaMesEnCurso();
      setFechaEntrega(def.toISOString().slice(0, 10));
    }
  }, [
    open,
    mode.kind === "fila" ? mode.actividad.id : mode.kind === "multiples" ? "multi-" + mode.actividades.map(a => a.id).join("-") : "nueva",
  ]);

  if (!open) return null;

  const supervisorSeleccionado =
    supervisores.find((s) => (s.email ?? "") === supervisorEmail) ?? null;

  // En modo "fila" la actividad viene dada por mode.actividad.
  // En modo "nueva" la asignación NO pertenece a la matriz → sólo título libre.
  // En modo "multiples" usamos la lista de matrizOptions pasadas.
  const filaActividad = mode.kind === "fila" ? mode.actividad : null;
  const tituloManual = isNueva ? tituloLibre.trim() : "";

  let actividadTituloFinal = "";
  if (tituloManual.length > 0) {
    actividadTituloFinal = tituloManual;
  } else if (filaActividad) {
    actividadTituloFinal =
      filaActividad.actividad.trim().length > 0
        ? `#${filaActividad.id} · ${filaActividad.actividad.trim()}`
        : `Actividad #${filaActividad.id} (sin nombre)`;
  }

  const encabezadoModal = isNueva
    ? "Nueva asignación (fuera de la matriz)"
    : isMulti
      ? `Reasignar ${mode.actividades.length} actividad${mode.actividades.length === 1 ? "" : "es"}`
      : isSelectionOnly
        ? "Seleccionar supervisor"
        : "Asignar a supervisor";

  const subtituloModal = isMulti
    ? mode.actividades.length === 0
      ? "No hay actividades seleccionadas."
      : `Se creará${mode.actividades.length === 1 ? "" : "n"} ${mode.actividades.length} asignaci${mode.actividades.length === 1 ? "ón" : "ones"} con el mismo supervisor, fecha y prioridad.`
    : isSelectionOnly
      ? "Elige el supervisor. Quedará asociado a esta fila hasta que lo cambies."
      : isFilaRapida
        ? "Elige el supervisor. Fecha límite y prioridad se fijan por defecto."
        : actividadTituloFinal.length > 0
          ? actividadTituloFinal
          : isNueva
            ? "Escribe un título para la asignación."
            : "Actividad sin título.";

  function buildTitleForMulti(a: MatrizOption): string {
    return a.actividad.trim().length > 0
      ? `#${a.id} · ${a.actividad.trim()}`
      : `Actividad #${a.id} (sin nombre)`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isMulti) {
      if (mode.actividades.length === 0) {
        setResult({ ok: false, error: "No hay actividades seleccionadas." });
        return;
      }
    } else if (!isSelectionOnly) {
      if (actividadTituloFinal.length === 0) {
        setResult({
          ok: false,
          error: isNueva
            ? "Escribe un título para la asignación."
            : "Actividad no válida en la matriz.",
        });
        return;
      }
    }
    if (!supervisorSeleccionado?.email) {
      setResult({ ok: false, error: "Selecciona un supervisor." });
      return;
    }
    if (!fechaEntrega && !isSelectionOnly) {
      setResult({ ok: false, error: "Selecciona fecha límite." });
      return;
    }

    // Modo selección: retiene la elección SIN crear asignación, pero espera
    // a que el wrapper persista en BD antes de cerrar, para mostrar feedback
    // claro de "Guardado OK / Falló" y no dejar al usuario sin saber.
    if (isSelectionOnly && selectionDisplayId != null) {
      const payload = {
        displayId: selectionDisplayId,
        supervisor: supervisorSeleccionado,
      };
      try {
        setSubmitting(true);
        setResult(null);
        await Promise.resolve(props.onSupervisorSelected?.(payload));
        setResult({ ok: true, id: "" });
        // Esperamos 600ms para que el usuario vea el banner "Guardado correctamente".
        setTimeout(() => {
          onClose();
        }, 650);
      } catch (err) {
        setResult({
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : "Error desconocido al guardar la asignación del supervisor.",
        });
      } finally {
        setSubmitting(false);
      }
      return;
    }

    try {
      setSubmitting(true);
      setResult(null);
      setMultiIds([]);
      setMultiErrors([]);

      const fechaISO = toISOAtMidnight(new Date(fechaEntrega + "T00:00:00Z"));
      const basePayload = {
        descripcion: descripcion.trim(),
        supervisorEmail: supervisorSeleccionado.email,
        supervisorName: supervisorSeleccionado.displayName,
        revisorEmail: currentUserEmail ?? "",
        revisorUserId: currentUserId,
        fechaEntregaLimiteISO: fechaISO,
        prioridad,
        status: "pendiente" as const,
        attachmentFiles: [] as [],
      };

      if (isMulti) {
        const items = mode.actividades;
        setProgressTotal(items.length);
        const ids: string[] = [];
        const errors: string[] = [];
        for (let i = 0; i < items.length; i++) {
          const a = items[i]!;
          setProgressCurrent(i);
          try {
            const r = await createAssignment({
              ...basePayload,
              actividadTitulo: buildTitleForMulti(a),
            });
            if (r.ok) {
              ids.push(r.id);
            } else {
              errors.push(`#${a.id}: ${r.error}`);
            }
          } catch (err) {
            errors.push(
              `#${a.id}: ${err instanceof Error ? err.message : "Error desconocido."}`
            );
          }
        }
        setProgressCurrent(items.length);
        setMultiIds(ids);
        setMultiErrors(errors);
        if (ids.length > 0 && errors.length === 0) {
          setResult({ ok: true, id: "" });
        } else if (ids.length > 0) {
          setResult({
            ok: false,
            error: `Se crearon ${ids.length} de ${items.length} asignaciones. ${errors.length} fallo${errors.length === 1 ? "" : "s"}.`,
          });
        } else {
          setResult({
            ok: false,
            error: `No se creó ninguna asignación. ${errors[0] ?? ""}`,
          });
        }
        if (ids.length > 0) {
          onCreated?.({ ok: true, ids, count: ids.length });
        }
      } else {
        const r = await createAssignment({
          ...basePayload,
          actividadTitulo: actividadTituloFinal,
        });
        setResult(r);
        if (r.ok) {
          onCreated?.({ ok: true, ids: [r.id], count: 1 });
        }
      }
    } catch (err) {
      setResult({
        ok: false,
        error:
          err instanceof Error ? err.message : "Error desconocido al crear la asignación.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Asignar actividad"
    >
      <div
        className="absolute inset-0 bg-zinc-950/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-lg rounded-2xl border border-zinc-200 bg-white shadow-xl">
        <form onSubmit={handleSubmit} className="flex max-h-[90dvh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-zinc-900">
                {encabezadoModal}
              </h2>
              <p className="mt-1 truncate text-xs text-zinc-500" title={subtituloModal}>
                {subtituloModal}
              </p>
              {isMulti && mode.actividades.length > 0 ? (
                <div className="mt-2 max-h-24 overflow-y-auto rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-600">
                  {mode.actividades.map((a, idx) => (
                    <div
                      key={a.id}
                      className={idx === 0 ? "" : "mt-1"}
                    >
                      <span className="font-mono text-zinc-400">#{a.id}</span>{" "}
                      {a.actividad.trim() || "(sin nombre)"}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
              aria-label="Cerrar"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                <path
                  d="M18 6L6 18M6 6l12 12"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          <div className="space-y-4 overflow-y-auto px-5 py-4">
            {isNueva ? (
              <div className="space-y-2 rounded-xl border border-zinc-100 bg-zinc-50/60 p-3">
                <label className="block text-xs font-medium text-zinc-700">
                  Título de la asignación
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  value={tituloLibre}
                  onChange={(e) => setTituloLibre(e.target.value)}
                  placeholder="Ej: Revisión semanal de actividades del eje 1…"
                  className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200"
                />
                <p className="text-[11px] text-zinc-500">
                  Esta asignación no pertenece a una actividad registrada en la matriz.
                </p>
              </div>
            ) : null}

            {isFilaRapida && !isSelectionOnly ? (
              <div className="rounded-xl border border-zinc-100 bg-zinc-50/60 p-3">
                <div className="mb-2 flex items-center gap-2 text-[11px] text-zinc-500">
                  <span className="inline-flex h-5 items-center rounded-full border border-zinc-200 bg-white px-2 font-medium text-zinc-600">
                    Fecha límite: {fechaEntrega ? humanDate(fechaEntrega) : "—"}
                  </span>
                  <span className="inline-flex h-5 items-center rounded-full border border-zinc-200 bg-white px-2 font-medium capitalize text-zinc-600">
                    Prioridad: {prioridad}
                  </span>
                </div>
              </div>
            ) : null}

            <div>
              <label className="block text-xs font-medium text-zinc-700">
                Supervisor asignado
              </label>
              <select
                required
                autoFocus={isFilaRapida || isSelectionOnly}
                value={supervisorEmail}
                onChange={(e) => setSupervisorEmail(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200"
              >
                <option value="">Selecciona un supervisor…</option>
                {supervisores.map((s) => (
                  <option key={s.id} value={s.email ?? ""}>
                    {s.displayName}
                    {s.email ? ` · ${s.email}` : ""}
                  </option>
                ))}
              </select>
              {supervisorSeleccionado && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2">
                  <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-700">
                    {initialsOf(
                      supervisorSeleccionado.displayName ||
                        supervisorSeleccionado.email
                    )}
                  </div>
                  <div className="min-w-0 text-xs">
                    <div className="truncate font-medium text-zinc-900">
                      {supervisorSeleccionado.displayName}
                    </div>
                    <div className="truncate text-zinc-500">
                      {supervisorSeleccionado.email ?? "Sin correo"}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {!isFilaRapida ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-700">
                    Fecha límite
                  </label>
                  <input
                    required
                    type="date"
                    value={fechaEntrega}
                    onChange={(e) => setFechaEntrega(e.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200"
                  />
                  {fechaEntrega ? (
                    <p className="mt-1 text-[11px] text-zinc-500">
                      Vence el {humanDate(fechaEntrega)}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700">Prioridad</label>
                  <select
                    value={prioridad}
                    onChange={(e) =>
                      setPrioridad(e.target.value as "alto" | "medio" | "bajo")
                    }
                    className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200"
                  >
                    <option value="alto">Urgente</option>
                    <option value="medio">Medio</option>
                    <option value="bajo">No Urgente</option>
                  </select>
                </div>
              </div>
            ) : null}

            {!isFilaRapida ? (
              <div>
                <label className="block text-xs font-medium text-zinc-700">
                  Notas para el supervisor{" "}
                  <span className="text-zinc-400">(opcional)</span>
                </label>
                <textarea
                  rows={4}
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  placeholder={
                    isMulti
                      ? "Instrucciones comunes que se aplicarán a TODAS las actividades seleccionadas…"
                      : "Instrucciones o contexto adicional para esta actividad…"
                  }
                  className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200"
                />
              </div>
            ) : null}

            {isMulti && submitting ? (
              <div className="space-y-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-3">
                <div className="flex items-center justify-between text-[11px] font-medium text-zinc-700">
                  <span>Creando asignaciones…</span>
                  <span className="font-mono">
                    {progressCurrent}/{progressTotal}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="h-full bg-zinc-900 transition-all"
                    style={{
                      width:
                        progressTotal === 0
                          ? "0%"
                          : `${(progressCurrent / progressTotal) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ) : null}

            {result ? (
              result.ok ? (
                isMulti ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    {multiIds.length} asignaci{multiIds.length === 1 ? "ón" : "ones"} creada
                    {multiIds.length === 1 ? "" : "s"} correctamente.
                    {multiErrors.length > 0 ? (
                      <span className="ml-1 text-emerald-900">
                        ({multiErrors.length} error{multiErrors.length === 1 ? "" : "es"}.)
                      </span>
                    ) : null}
                  </div>
                ) : isSelectionOnly ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    Supervisor asignado correctamente. Quedará guardado de forma permanente.
                  </div>
                ) : (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    Asignación creada correctamente.
                  </div>
                )
              ) : (
                <div className="space-y-1">
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {result.error}
                  </div>
                  {multiErrors.length > 0 ? (
                    <ul className="max-h-28 list-disc overflow-y-auto rounded-lg border border-red-100 bg-red-50/60 px-5 py-2 text-[11px] text-red-700">
                      {multiErrors.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || (isMulti && mode.actividades.length === 0)}
              className="inline-flex h-9 items-center justify-center rounded-md bg-zinc-900 px-3.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting
                ? isMulti
                  ? `Creando ${progressCurrent}/${progressTotal}…`
                  : isSelectionOnly
                    ? "Guardando…"
                    : "Creando…"
                : isMulti
                  ? `Crear ${mode.actividades.length} asignaci${
                      mode.actividades.length === 1 ? "ón" : "ones"
                    }`
                  : isSelectionOnly
                    ? "Seleccionar"
                    : isFilaRapida
                      ? "Asignar"
                      : "Crear asignación"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
