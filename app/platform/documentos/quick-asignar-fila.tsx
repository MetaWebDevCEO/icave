"use client";

import * as React from "react";
import { createAssignment } from "@/app/platform/revisor/asignacion/actions";
import { sileo } from "sileo";

export type MatrizOption = { id: number; actividad: string };
export type SupervisorOption = {
  id: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  userId?: string;
};

export type ModalMode =
  | { kind: "fila"; actividad: MatrizOption }
  | { kind: "multiples"; actividades: MatrizOption[] };

const ALL_SUPERVISORS_VALUE = "__ALL_SUPERVISORS__";

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

function getAssignableSupervisors(supervisores: SupervisorOption[]) {
  const dedup = new Map<string, SupervisorOption>();
  for (const supervisor of supervisores) {
    const email = (supervisor.email ?? "").trim().toLowerCase();
    if (!email || dedup.has(email)) continue;
    dedup.set(email, supervisor);
  }
  return Array.from(dedup.values());
}

export type QuickAsignarFilaProps = {
  open: boolean;
  onClose: () => void;
  currentUserEmail: string | undefined;
  currentUserId: string;
  mode: ModalMode;
  matrizOptions: MatrizOption[];
  supervisores: SupervisorOption[];
  onCreated?: (result: {
    ok: true;
    ids: string[];
    count: number;
    displayIds: number[];
    supervisors: SupervisorOption[];
    assigningToAll: boolean;
  }) => Promise<void> | void;
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
    supervisores,
    onCreated,
    onSupervisorSelected,
  } = props;

  const isMulti = mode.kind === "multiples";
  const isFilaRapida = mode.kind === "fila";
  const isSelectionOnly = Boolean(props.selectionOnly);
  const selectionDisplayId = props.selectionOnly?.displayId ?? null;
  const assignableSupervisors = React.useMemo(
    () => getAssignableSupervisors(supervisores),
    [supervisores]
  );

  const [supervisorEmail, setSupervisorEmail] = React.useState<string>("");
  const [fechaEntrega, setFechaEntrega] = React.useState<string>(() =>
    ultimoDiaMesEnCurso().toISOString().slice(0, 10)
  );
  const [prioridad, setPrioridad] = React.useState<"alto" | "medio" | "bajo">("medio");
  const [descripcion, setDescripcion] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState<boolean>(false);

  // Progress for multiples
  const [progressCurrent, setProgressCurrent] = React.useState<number>(0);
  const [progressTotal, setProgressTotal] = React.useState<number>(0);

  if (!open) return null;

  const assigningToAll =
    !isSelectionOnly && supervisorEmail === ALL_SUPERVISORS_VALUE;
  const supervisorSeleccionado =
    assignableSupervisors.find((s) => (s.email ?? "") === supervisorEmail) ??
    null;
  const targetSupervisores = assigningToAll
    ? assignableSupervisors
    : supervisorSeleccionado?.email
      ? [supervisorSeleccionado]
      : [];

  // En modo "fila" la actividad viene dada por mode.actividad.
  // En modo "multiples" usamos la lista de actividades seleccionadas.
  const filaActividad = mode.kind === "fila" ? mode.actividad : null;

  let actividadTituloFinal = "";
  if (filaActividad) {
    actividadTituloFinal =
      filaActividad.actividad.trim().length > 0
        ? `#${filaActividad.id} · ${filaActividad.actividad.trim()}`
        : `Actividad #${filaActividad.id} (sin nombre)`;
  }

  const encabezadoModal = isMulti
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
        sileo.error({ title: "Sin actividades", description: "No hay actividades seleccionadas." });
        return;
      }
    } else if (!isSelectionOnly) {
      if (actividadTituloFinal.length === 0) {
        sileo.error({
          title: "Falta el título",
          description: "Actividad no válida en la matriz.",
        });
        return;
      }
    }
    if (targetSupervisores.length === 0) {
      sileo.error({ title: "Falta el supervisor", description: "Selecciona un supervisor." });
      return;
    }
    if (!fechaEntrega && !isSelectionOnly) {
      sileo.error({ title: "Falta la fecha límite", description: "Selecciona fecha límite." });
      return;
    }

    // Modo selección: retiene la elección SIN crear asignación, pero espera
    // a que el wrapper persista en BD antes de cerrar, para confirmar el
    // "Guardado OK / Falló" y no dejar al usuario sin saber.
    if (isSelectionOnly && selectionDisplayId != null) {
      const payload = {
        displayId: selectionDisplayId,
        supervisor: targetSupervisores[0]!,
      };
      try {
        setSubmitting(true);
        await Promise.resolve(onSupervisorSelected?.(payload));
        sileo.success({
          title: "Supervisor asignado",
          description: "Quedará guardado de forma permanente.",
        });
        onClose();
      } catch (err) {
        sileo.error({
          title: "No se pudo guardar",
          description:
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

      const fechaISO = toISOAtMidnight(new Date(fechaEntrega + "T00:00:00Z"));
      const basePayload = {
        descripcion: descripcion.trim(),
        revisorEmail: currentUserEmail ?? "",
        revisorUserId: currentUserId,
        fechaEntregaLimiteISO: fechaISO,
        prioridad,
        status: "pendiente" as const,
        attachmentFiles: [] as [],
      };

      if (isMulti) {
        const items = mode.actividades;
        const totalAssignments = items.length * targetSupervisores.length;
        setProgressTotal(totalAssignments);
        const ids: string[] = [];
        const errors: string[] = [];
        let completed = 0;
        for (const a of items) {
          for (const supervisor of targetSupervisores) {
            setProgressCurrent(completed);
            try {
              const r = await createAssignment({
                ...basePayload,
                actividadTitulo: buildTitleForMulti(a),
                supervisorEmail: supervisor.email!,
                supervisorName: supervisor.displayName,
                matrizFilaId: a.id,
              });
              if (r.ok) {
                ids.push(r.id);
              } else {
                errors.push(
                  `#${a.id} · ${supervisor.displayName}: ${r.error}`
                );
              }
            } catch (err) {
              errors.push(
                `#${a.id} · ${supervisor.displayName}: ${
                  err instanceof Error ? err.message : "Error desconocido."
                }`
              );
            } finally {
              completed += 1;
              setProgressCurrent(completed);
            }
          }
        }

        const detalleErrores = errors.slice(0, 3).join(" · ");
        if (ids.length > 0 && errors.length === 0) {
          sileo.success({
            title: "Asignaciones creadas",
            description: assigningToAll
              ? `${ids.length} asignaciones creadas para ${targetSupervisores.length} supervisores.`
              : `${ids.length} asignaci${ids.length === 1 ? "ón" : "ones"} creada${
                  ids.length === 1 ? "" : "s"
                } correctamente.`,
          });
        } else if (ids.length > 0) {
          sileo.warning({
            title: "Asignaciones parciales",
            description: `Se crearon ${ids.length} de ${items.length}. ${errors.length} fallo${
              errors.length === 1 ? "" : "s"
            }.${detalleErrores ? ` ${detalleErrores}` : ""}`,
          });
        } else {
          sileo.error({
            title: "No se creó ninguna asignación",
            description: errors[0] ?? "Intenta de nuevo.",
          });
        }
        if (ids.length > 0) {
          await Promise.resolve(
            onCreated?.({
              ok: true,
              ids,
              count: ids.length,
              displayIds: items.map((item) => item.id),
              supervisors: targetSupervisores,
              assigningToAll,
            })
          );
        }
      } else {
        const ids: string[] = [];
        const errors: string[] = [];
        for (const supervisor of targetSupervisores) {
          const r = await createAssignment({
            ...basePayload,
            actividadTitulo: actividadTituloFinal,
            supervisorEmail: supervisor.email!,
            supervisorName: supervisor.displayName,
            matrizFilaId: mode.kind === "fila" ? mode.actividad.id : null,
          });
          if (r.ok) {
            ids.push(r.id);
          } else {
            errors.push(`${supervisor.displayName}: ${r.error || "Intenta de nuevo."}`);
          }
        }
        if (ids.length > 0 && errors.length === 0) {
          sileo.success({
            title: "Asignación creada",
            description: assigningToAll
              ? `La tarea se creó para ${targetSupervisores.length} supervisores.`
              : "La tarea se creó correctamente.",
          });
          await Promise.resolve(
            onCreated?.({
              ok: true,
              ids,
              count: ids.length,
              displayIds: mode.kind === "fila" ? [mode.actividad.id] : [],
              supervisors: targetSupervisores,
              assigningToAll,
            })
          );
        } else if (ids.length > 0) {
          sileo.warning({
            title: "Asignaciones parciales",
            description: `Se crearon ${ids.length} de ${targetSupervisores.length}. ${errors[0] ?? ""}`.trim(),
          });
          await Promise.resolve(
            onCreated?.({
              ok: true,
              ids,
              count: ids.length,
              displayIds: mode.kind === "fila" ? [mode.actividad.id] : [],
              supervisors: targetSupervisores,
              assigningToAll,
            })
          );
        } else {
          sileo.error({
            title: "No se pudo crear la asignación",
            description: errors[0] || "Intenta de nuevo.",
          });
        }
      }
    } catch (err) {
      sileo.error({
        title: "Error al crear la asignación",
        description:
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
                {!isSelectionOnly && assignableSupervisors.length > 1 ? (
                  <option value={ALL_SUPERVISORS_VALUE}>
                    Todos los supervisores ({assignableSupervisors.length})
                  </option>
                ) : null}
                {assignableSupervisors.map((s) => (
                  <option key={s.id} value={s.email ?? ""}>
                    {s.displayName}
                    {s.email ? ` · ${s.email}` : ""}
                  </option>
                ))}
              </select>
              {assigningToAll ? (
                <div className="mt-2 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
                  Se creará una asignación por cada actividad para los{" "}
                  <span className="font-semibold">
                    {assignableSupervisors.length} supervisores
                  </span>{" "}
                  disponibles.
                </div>
              ) : supervisorSeleccionado ? (
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
              ) : null}
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
                  ? `Crear ${
                      mode.actividades.length *
                      Math.max(targetSupervisores.length, 1)
                    } asignaci${
                      mode.actividades.length * Math.max(targetSupervisores.length, 1) === 1
                        ? "ón"
                        : "ones"
                    }`
                  : isSelectionOnly
                    ? "Seleccionar"
                    : isFilaRapida
                      ? assigningToAll
                        ? `Asignar a ${targetSupervisores.length}`
                        : "Asignar"
                      : "Crear asignación"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
