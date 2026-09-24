"use client";

import * as React from "react";
import { formatCalendarDateShort } from "@/lib/calendar-date";
import {
  QuickAsignarFila,
  type MatrizOption,
  type SupervisorOption,
  type ModalMode,
} from "./quick-asignar-fila";
import {
  createAssignment,
  type CreateAssignmentResult,
  updateAssignmentBasics,
  type UpdateAssignmentBasicsResult,
} from "@/app/platform/revisor/asignacion/actions";
import { setMatrizSupervisor } from "./matriz-supervisor-actions";

export type FilaMatriz = {
  id: string;
  displayId: number;
  actividad: string;
  frecuencia: string;
  created_at: string | null;
};

type Props = {
  safeRows: FilaMatriz[];
  listErrorMessage: string | null;
  currentUserEmail: string | undefined;
  currentUserId: string;
  matrizOptions: MatrizOption[];
  supervisores: SupervisorOption[];
  definidas: number;
  vacias: number;
  total: number;
  initialSupervisoresAsignados: Map<number, SupervisorOption>;
};

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
 * Último día del mes en curso (zona local del navegador/servidor).
 * Truco: new Date(año, mesSiguiente, 0) → día 0 del mes que viene = último
 * día del mes actual. `setHours(0,0,0,0)` para que el time sea medianoche.
 */
function ultimoDiaMesEnCurso(): Date {
  const ahora = new Date();
  const d = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0);
  d.setHours(0, 0, 0, 0);
  return d;
}

function SupervisorAsignarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="h-3.5 w-3.5"
    >
      <path
        d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="9"
        cy="7"
        r="4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function initialsOf(input: string | null | undefined): string {
  if (!input) return "?";
  const trimmed = input.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/[\s.@-]+/).filter(Boolean);
  if (parts.length === 0) return trimmed[0]?.toUpperCase() ?? "?";
  return (
    (parts[0]?.[0] ?? "") +
    (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "")
  )
    .toUpperCase()
    .slice(0, 2);
}

type DialogKind =
  | null
  | { kind: "seleccionarSupervisor"; displayId: number }
  | { kind: "nuevaAsignacionFueraDeMatriz" }
  | { kind: "reasignarMasivo" }
  | {
      kind: "editarAsignacion";
      displayId: number;
      assignmentId: string;
      initialTitle: string;
      initialDueAtISO: string;
    }
  | {
      kind: "preconfigurarFila";
      displayId: number;
      initialTitle: string;
      initialFechaISO: string;
    };

export function ArchiveroMatrizList(props: Props) {
  const {
    safeRows,
    listErrorMessage,
    currentUserEmail,
    currentUserId,
    matrizOptions,
    supervisores,
    definidas,
    vacias,
    total,
    initialSupervisoresAsignados,
  } = props;

  const [dialog, setDialog] = React.useState<DialogKind>(null);
  const [checked, setChecked] = React.useState<Set<number>>(new Set());
  /**
   * Asociación persistente en cliente. Se inicializa desde DB (prop
   * `initialSupervisoresAsignados`) y se actualiza:
   * - Optimista cuando el usuario elige/quita un supervisor.
   * - Se persiste en background via `setMatrizSupervisor`.
   * - Si falla la persistencia, se hace REVERT al valor anterior y se
   *   muestra feedback inline de error.
   * Esta asociación NUNCA se modifica por crear la asignación (Check).
   * Solo cambia cuando el usuario pulsa "Cambiar" o "Quitar" en el chip.
   */
  const [supervisorPorFila, setSupervisorPorFila] = React.useState<
    Map<number, SupervisorOption>
  >(new Map(initialSupervisoresAsignados));
  const [savingSupervisors, setSavingSupervisors] = React.useState<
    Set<number>
  >(new Set());
  const [supervisorError, setSupervisorError] = React.useState<
    Map<number, string>
  >(new Map());

  const [creatingIds, setCreatingIds] = React.useState<Set<number>>(new Set());
  const [feedbackPorFila, setFeedbackPorFila] = React.useState<
    Map<number, { ok: boolean; msg: string }>
  >(new Map());

  /**
   * Cada vez que una fila materializa la asignación via Check, guardamos
   * aquí el id/titulo/fecha para que el botón Editar lápiz pueda abrirla
   * y modificar (título + fecha vencimiento).
   * key = displayId de la fila de matriz (NO el assignmentId)
   */
  type AsignacionCreadaMeta = {
    id: string;
    title: string;
    dueAtISO: string;
  };
  const [asignacionesCreadas, setAsignacionesCreadas] = React.useState<
    Map<number, AsignacionCreadaMeta>
  >(new Map());

  /**
   * Pre-configuración POR FILA (antes de darle Check/crear asignación).
   * Permite editar el TÍTULO y la FECHA LÍMITE antes de:
   *   1) seleccionar supervisor, 2) pulsar Check, o 3) pulsar "Reasignar marcadas".
   * Si el usuario NO la configura, se usan defaults:
   *   - titulo = #id · actividad (o Actividad #id sin nombre)
   *   - fecha  = último día del mes en curso.
   * Esta asociación es state de cliente → sobrevive renders (mientras no F5).
   * Si pulsas Check, se materializa la asignación con estos valores.
   * Si la fila ya tenía asignación creada (hay meta en asignacionesCreadas), al
   * volver a Editar se abre la vía UPDATE real en BD (editarAsignacion).
   */
  type PreFila = { titulo: string; fechaISO: string };
  const [prePorFila, setPrePorFila] = React.useState<Map<number, PreFila>>(
    new Map()
  );

  const getPreOrDefault = React.useCallback(
    (displayId: number): PreFila => {
      const pre = prePorFila.get(displayId);
      if (pre) return pre;
      const act =
        matrizOptions.find((m) => m.id === displayId) ??
        safeRows.find((r) => r.displayId === displayId) ??
        null;
      const titulo = act
        ? act.actividad.trim().length > 0
          ? `#${act.id} · ${act.actividad.trim()}`
          : `Actividad #${act.id} (sin nombre)`
        : `Actividad #${displayId}`;
      return {
        titulo,
        fechaISO: toISOAtMidnight(ultimoDiaMesEnCurso()),
      };
    },
    [prePorFila, matrizOptions, safeRows]
  );

  // ---- Formulario Editar Asignación (título + fecha vencimiento) ----
  const [editarTitulo, setEditarTitulo] = React.useState<string>("");
  const [editarFecha, setEditarFecha] = React.useState<string>("");
  const [editarSubmitting, setEditarSubmitting] = React.useState<boolean>(false);
  const [editarResult, setEditarResult] = React.useState<
    { ok: true } | { ok: false; error: string } | null
  >(null);

  // ---- Formulario PRE-CONFIGURAR FILA (antes de crear asignación) ----
  const [preTitulo, setPreTitulo] = React.useState<string>("");
  const [preFecha, setPreFecha] = React.useState<string>("");
  const [preResult, setPreResult] = React.useState<
    { ok: true } | { ok: false; error: string } | null
  >(null);

  // Cuando se abre el dialog de cualquiera de los 2 formularios, inicializar inputs.
  React.useEffect(() => {
    if (!dialog) return;
    if (dialog.kind === "editarAsignacion") {
      setEditarTitulo(dialog.initialTitle);
      setEditarFecha(dialog.initialDueAtISO.slice(0, 10));
      setEditarResult(null);
      setEditarSubmitting(false);
      return;
    }
    if (dialog.kind === "preconfigurarFila") {
      setPreTitulo(dialog.initialTitle);
      setPreFecha(dialog.initialFechaISO.slice(0, 10));
      setPreResult(null);
      return;
    }
  }, [dialog]);

  async function handleSubmitEditar(e: React.FormEvent) {
    e.preventDefault();
    if (!dialog || dialog.kind !== "editarAsignacion") return;
    if (editarSubmitting) return;

    const t = editarTitulo.trim();
    if (!t.length) {
      setEditarResult({ ok: false, error: "El nombre no puede quedar vacío." });
      return;
    }
    if (!editarFecha) {
      setEditarResult({ ok: false, error: "Selecciona fecha de entrega." });
      return;
    }

    setEditarSubmitting(true);
    setEditarResult(null);

    try {
      const r: UpdateAssignmentBasicsResult = await updateAssignmentBasics({
        assignmentId: dialog.assignmentId,
        nuevoTitulo: t,
        nuevaFechaEntregaISO: `${editarFecha}T00:00:00.000Z`,
      });

      if (r.ok) {
        // Actualizar cache local de asignaciones creadas
        setAsignacionesCreadas((prev) => {
          const n = new Map(prev);
          n.set(dialog.displayId, {
            id: dialog.assignmentId,
            title: r.title,
            dueAtISO: r.due_at,
          });
          return n;
        });
        setFeedbackPorFila((prev) => {
          const n = new Map(prev);
          n.set(dialog.displayId, { ok: true, msg: "Cambios guardados." });
          return n;
        });
        setTimeout(() => {
          setFeedbackPorFila((prev) => {
            const n = new Map(prev);
            const fb = n.get(dialog.displayId);
            if (fb && fb.msg === "Cambios guardados.") n.delete(dialog.displayId);
            return n;
          });
        }, 3500);
        setEditarResult({ ok: true });
        setTimeout(() => setDialog(null), 650);
      } else {
        setEditarResult({ ok: false, error: r.error });
      }
    } catch (err) {
      setEditarResult({
        ok: false,
        error: err instanceof Error ? err.message : "Error desconocido al guardar.",
      });
    } finally {
      setEditarSubmitting(false);
    }
  }

  function handleSubmitPreconfigurar(e: React.FormEvent) {
    e.preventDefault();
    if (!dialog || dialog.kind !== "preconfigurarFila") return;

    const t = preTitulo.trim();
    if (!t.length) {
      setPreResult({ ok: false, error: "El nombre no puede quedar vacío." });
      return;
    }
    if (!preFecha) {
      setPreResult({ ok: false, error: "Selecciona fecha de entrega." });
      return;
    }

    setPrePorFila((prev) => {
      const n = new Map(prev);
      n.set(dialog.displayId, {
        titulo: t,
        fechaISO: `${preFecha}T00:00:00.000Z`,
      });
      return n;
    });

    setFeedbackPorFila((prev) => {
      const n = new Map(prev);
      n.set(dialog.displayId, {
        ok: true,
        msg: "Pre-configurado. Se usará al crear la asignación.",
      });
      return n;
    });
    setTimeout(() => {
      setFeedbackPorFila((prev) => {
        const n = new Map(prev);
        const fb = n.get(dialog.displayId);
        if (
          fb &&
          fb.msg === "Pre-configurado. Se usará al crear la asignación."
        ) {
          n.delete(dialog.displayId);
        }
        return n;
      });
    }, 3500);

    setPreResult({ ok: true });
    setTimeout(() => setDialog(null), 550);
  }

  const definidasIds = React.useMemo(
    () =>
      safeRows
        .filter((r) => r.actividad.length > 0)
        .map((r) => r.displayId),
    [safeRows]
  );

  const toggleOne = (id: number) => {
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const todasDefinidasMarcadas =
    definidasIds.length > 0 && definidasIds.every((i) => checked.has(i));

  const setAllDefinidas = (on: boolean) => {
    setChecked((prev) => {
      const n = new Set(prev);
      for (const id of definidasIds) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  };

  const seleccionadas = React.useMemo(
    () => Array.from(checked).sort((a, b) => a - b),
    [checked]
  );

  const actividadesSeleccionadas: MatrizOption[] = React.useMemo(() => {
    return seleccionadas
      .map((id) => {
        const found = matrizOptions.find((m) => m.id === id);
        if (found) return found;
        const row = safeRows.find((r) => r.displayId === id);
        return row ? { id: row.displayId, actividad: row.actividad } : null;
      })
      .filter((x): x is MatrizOption => x !== null);
  }, [seleccionadas, matrizOptions, safeRows]);

  const supervisorDeFila = (id: number) => supervisorPorFila.get(id) ?? null;

  function abrirSeleccionarSupervisor(displayId: number) {
    setDialog({ kind: "seleccionarSupervisor", displayId });
  }
  function abrirNuevaAsignacionFueraDeMatriz() {
    setDialog({ kind: "nuevaAsignacionFueraDeMatriz" });
  }
  function abrirReasignarMasivo() {
    if (actividadesSeleccionadas.length === 0) return;
    setDialog({ kind: "reasignarMasivo" });
  }

  function cerrarDialogo() {
    setDialog(null);
  }

  /**
   * Persiste en BD un cambio de supervisor para una fila. Actualiza UI de
   * forma optimista, y si falla la persistencia, revierte al estado previo
   * (para garantizar que UI === DB en todo momento).
   * Además, si falla, LANZA excepción al final para que el Modal (en
   * QuickAsignarFila, modo selección) también se entere y muestre banner
   * rojo con el detalle. Sin esto, el Modal pensaba que todo era OK y
   * mostraba "Supervisor asignado correctamente" aun cuando no.
   */
  async function persistirSupervisor(
    displayId: number,
    nuevo: SupervisorOption | null,
    previous: SupervisorOption | null
  ) {
    let lastError: string | null = null;

    // 1. Optimistic update
    setSupervisorPorFila((prev) => {
      const n = new Map(prev);
      if (nuevo) n.set(displayId, nuevo);
      else n.delete(displayId);
      return n;
    });
    setSupervisorError((prev) => {
      const n = new Map(prev);
      n.delete(displayId);
      return n;
    });
    setSavingSupervisors((prev) => new Set(prev).add(displayId));

    try {
      const r = await setMatrizSupervisor({
        displayId,
        supervisorUserId: nuevo ? nuevo.userId ?? nuevo.id : null,
      });
      if (!r.ok) throw new Error(r.error);
      // Asegurar consistencia: la server action pudo haber devuelto un
      // SupervisorOption enriquecido. Lo actualizamos si hay.
      if (r.supervisor) {
        setSupervisorPorFila((prev) => {
          const n = new Map(prev);
          n.set(displayId, r.supervisor!);
          return n;
        });
      } else if (!nuevo) {
        setSupervisorPorFila((prev) => {
          const n = new Map(prev);
          n.delete(displayId);
          return n;
        });
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Error desconocido.";
      // REVERT
      setSupervisorPorFila((prev) => {
        const n = new Map(prev);
        if (previous) n.set(displayId, previous);
        else n.delete(displayId);
        return n;
      });
      setSupervisorError((prev) => {
        const n = new Map(prev);
        n.set(displayId, lastError!);
        return n;
      });
    } finally {
      setSavingSupervisors((prev) => {
        const n = new Set(prev);
        n.delete(displayId);
        return n;
      });
    }

    if (lastError !== null) {
      throw new Error(lastError);
    }
  }

  /**
   * Versión async (esperada por QuickAsignarFila en modo selección).
   * Permite al modal esperar la persistencia real y mostrar
   * banner verde / rojo según el resultado de la BD antes de cerrarse.
   * También hace el optimistic update local por si hay re-renders.
   */
  async function onSupervisorSelected(p: {
    displayId: number;
    supervisor: SupervisorOption;
  }): Promise<void> {
    const current = supervisorDeFila(p.displayId);
    if (
      current &&
      (current.userId ?? current.id) ===
        (p.supervisor.userId ?? p.supervisor.id)
    ) {
      return;
    }
    await persistirSupervisor(p.displayId, p.supervisor, current);
  }

  async function quitarSupervisor(displayId: number) {
    const current = supervisorDeFila(displayId);
    if (!current) return;
    void persistirSupervisor(displayId, null, current);
  }

  function handleMasivoCreated() {
    setChecked(new Set());
  }

  /**
   * Crea LA ASIGNACIÓN en BD para una sola fila (botón Check ✓).
   * Si esa fila NO tiene supervisor asociado → abre el modal de selección primero.
   */
  async function tryCrearAsignacionIndividual(displayId: number) {
    const supervisor = supervisorDeFila(displayId);
    if (!supervisor?.email) {
      abrirSeleccionarSupervisor(displayId);
      return;
    }

    const pre = getPreOrDefault(displayId);
    const titulo = pre.titulo.trim().length > 0 ? pre.titulo : `Actividad #${displayId}`;
    const fechaISO = pre.fechaISO ? toISOAtMidnight(new Date(pre.fechaISO)) : toISOAtMidnight(ultimoDiaMesEnCurso());

    try {
      setCreatingIds((prev) => new Set(prev).add(displayId));
      setFeedbackPorFila((prev) => {
        const n = new Map(prev);
        n.delete(displayId);
        return n;
      });

      const r: CreateAssignmentResult = await createAssignment({
        actividadTitulo: titulo,
        descripcion: "",
        supervisorEmail: supervisor.email,
        supervisorName: supervisor.displayName,
        revisorEmail: currentUserEmail ?? "",
        revisorUserId: currentUserId,
        fechaEntregaLimiteISO: fechaISO,
        prioridad: "medio",
        status: "pendiente",
        attachmentFiles: [],
      });

      setFeedbackPorFila((prev) => {
        const n = new Map(prev);
        n.set(displayId, {
          ok: r.ok,
          msg: r.ok ? "Asignación creada." : r.error,
        });
        return n;
      });
      if (r.ok) {
        setAsignacionesCreadas((prev) => {
          const n = new Map(prev);
          n.set(displayId, {
            id: r.id,
            title: titulo,
            dueAtISO: fechaISO,
          });
          return n;
        });
        setTimeout(() => {
          setFeedbackPorFila((prev) => {
            const n = new Map(prev);
            n.delete(displayId);
            return n;
          });
        }, 4000);
      }
    } catch (err) {
      setFeedbackPorFila((prev) => {
        const n = new Map(prev);
        n.set(displayId, {
          ok: false,
          msg: err instanceof Error ? err.message : "Error desconocido.",
        });
        return n;
      });
    } finally {
      setCreatingIds((prev) => {
        const n = new Set(prev);
        n.delete(displayId);
        return n;
      });
    }
  }

  const modoMultiActivo = dialog?.kind === "reasignarMasivo";
  const modoNuevaActivo = dialog?.kind === "nuevaAsignacionFueraDeMatriz";
  const modoSelActivo = dialog?.kind === "seleccionarSupervisor";

  let modalMode: ModalMode = { kind: "nueva" };
  let selectionOnly: { displayId: number } | undefined = undefined;

  if (modoSelActivo) {
    const displayId = dialog.displayId;
    const actividad =
      matrizOptions.find((m) => m.id === displayId) ??
      (() => {
        const r = safeRows.find((rr) => rr.displayId === displayId);
        return { id: displayId, actividad: r?.actividad ?? "" };
      })();
    modalMode = { kind: "fila", actividad };
    selectionOnly = { displayId };
  } else if (modoNuevaActivo) {
    modalMode = { kind: "nueva" };
  } else if (modoMultiActivo) {
    modalMode = { kind: "multiples", actividades: actividadesSeleccionadas };
  }

  const modalOpen = modoSelActivo || modoNuevaActivo || modoMultiActivo;

  return (
    <>
      <div className="shrink-0 pb-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                Matriz de Control
              </div>
              <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Seguimiento de actividades desde la tabla
                <span className="ml-1 font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                  matriz
                </span>
                .
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="hidden items-center gap-3 text-[11px] text-zinc-500 sm:flex">
              <span>
                <span className="font-semibold text-zinc-800">
                  {definidas}
                </span>{" "}
                definidas
              </span>
              <span className="h-3 w-px bg-zinc-200" />
              <span>
                <span className="font-semibold text-zinc-800">{vacias}</span>{" "}
                vacías
              </span>
              <span className="h-3 w-px bg-zinc-200" />
              <span>
                <span className="font-semibold text-zinc-800">{total}</span>{" "}
                totales
              </span>
            </div>

            {/* Controles de selección masiva */}
            <div className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-black dark:text-zinc-300">
              <label className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-zinc-300 text-zinc-900 focus:ring-0"
                  checked={todasDefinidasMarcadas}
                  onChange={(e) => setAllDefinidas(e.target.checked)}
                  title={
                    todasDefinidasMarcadas
                      ? "Desmarcar todas las actividades definidas"
                      : "Marcar todas las actividades definidas para reasignación rápida"
                  }
                />
                <span className="font-medium">Todas</span>
              </label>
              <span className="h-3 w-px bg-zinc-200 dark:bg-zinc-800" />
              <span className="whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  {seleccionadas.length}
                </span>{" "}
                marcada{seleccionadas.length === 1 ? "" : "s"}
              </span>
            </div>

            <button
              type="button"
              onClick={abrirReasignarMasivo}
              disabled={seleccionadas.length === 0}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-zinc-900 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-400 disabled:hover:bg-white dark:border-zinc-50 dark:bg-black dark:text-zinc-50 dark:hover:bg-zinc-900 dark:disabled:border-zinc-800 dark:disabled:text-zinc-500"
              title={
                seleccionadas.length === 0
                  ? "Marca al menos una actividad para reasignar en lote"
                  : `Crear ${seleccionadas.length} asignaciones en lote (Reasignar marcadas)`
              }
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="h-3.5 w-3.5"
                aria-hidden="true"
              >
                <path
                  d="M9 12l2 2 4-4"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              Reasignar marcadas
            </button>

            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-black dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Exportar
            </button>
            <button
              type="button"
              onClick={abrirNuevaAsignacionFueraDeMatriz}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              title="Nueva asignación fuera de la matriz"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="h-3.5 w-3.5"
                aria-hidden="true"
              >
                <path
                  d="M12 5v14M5 12h14"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Nueva asignación
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="grid grid-cols-12 sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50 px-5 py-3 text-xs font-semibold text-zinc-600 shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
          <div className="col-span-1 text-left pl-0.5">
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-zinc-300 text-zinc-900 focus:ring-0"
                checked={todasDefinidasMarcadas}
                onChange={(e) => setAllDefinidas(e.target.checked)}
                title="Marcar todas las actividades definidas"
              />
              <span className="hidden sm:inline">#</span>
            </label>
          </div>
          <div className="col-span-7">Actividad</div>
          <div className="col-span-2">Asignar a</div>
          <div className="col-span-2 text-right">Acciones</div>
        </div>

        <div className="max-h-[calc(100%-3rem)] overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-900">
          {listErrorMessage ? (
            <div className="px-5 py-8 text-sm text-red-700 dark:text-red-300">
              {listErrorMessage}
            </div>
          ) : safeRows.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
              La tabla <span className="font-mono">matriz</span> está vacía.
            </div>
          ) : (
            safeRows.map((r) => {
              const createdLabel = r.created_at
                ? formatCalendarDateShort(r.created_at)
                : "—";
              const isChecked = checked.has(r.displayId);
              const sup = supervisorDeFila(r.displayId);
              const creando = creatingIds.has(r.displayId);
              const fb = feedbackPorFila.get(r.displayId) ?? null;
              const supSaving = savingSupervisors.has(r.displayId);
              const supErr = supervisorError.get(r.displayId) ?? null;

              return (
                <div
                  key={r.id}
                  className={
                    "grid grid-cols-12 items-center gap-3 px-5 py-4 text-sm text-zinc-700 dark:text-zinc-300 transition-colors " +
                    (isChecked
                      ? "bg-zinc-50 dark:bg-zinc-900/40"
                      : "hover:bg-zinc-50/60 dark:hover:bg-zinc-900/40")
                  }
                >
                  <div className="col-span-1 flex items-center gap-2 pl-0.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-0"
                      checked={isChecked}
                      onChange={() => toggleOne(r.displayId)}
                      title={
                        isChecked
                          ? "Quitar del lote de reasignación masiva"
                          : "Incluir en el lote 'Reasignar marcadas'"
                      }
                    />
                    <span className="font-mono text-[11px] text-zinc-400">
                      {r.displayId}
                    </span>
                  </div>

                  <div
                    className="col-span-7 truncate font-medium leading-snug text-zinc-950 dark:text-zinc-50"
                    title={
                      r.actividad
                        ? r.actividad + "\n\nCreada: " + createdLabel
                        : "Creada: " + createdLabel
                    }
                  >
                    {r.actividad.length > 0 ? r.actividad : "—"}
                    {r.frecuencia.length > 0 ? (
                      <span className="ml-2 inline-flex items-center rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:border-zinc-800 dark:bg-black dark:text-zinc-400">
                        {r.frecuencia}
                      </span>
                    ) : null}
                    {fb ? (
                      <span
                        className={
                          "ml-2 inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium " +
                          (fb.ok
                            ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border border-red-200 bg-red-50 text-red-700")
                        }
                      >
                        {fb.ok ? "✓ " : "⚠ "}
                        {fb.msg}
                      </span>
                    ) : null}
                  </div>

                  <div className="col-span-2">
                    {sup ? (
                      <button
                        type="button"
                        onClick={() => abrirSeleccionarSupervisor(r.displayId)}
                        className={
                          "group flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors " +
                          (supErr
                            ? "border-red-400 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-700 dark:bg-red-950 dark:text-red-200"
                            : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-black dark:text-zinc-300 dark:hover:bg-zinc-900")
                        }
                        title={
                          supErr
                            ? "Error al guardar supervisor persistente: " +
                              supErr +
                              " · Click para reintentar (Cambiar supervisor)"
                            : `Cambiar supervisor asignado (actual: ${sup.displayName}) — se mantiene aunque cambies de mes, recargues o cierres sesión`
                        }
                      >
                        {supSaving ? (
                          <svg
                            className="h-5 w-5 animate-spin"
                            viewBox="0 0 24 24"
                            fill="none"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                            />
                          </svg>
                        ) : sup.avatarUrl ? (
                          <img
                            src={sup.avatarUrl}
                            alt={sup.displayName}
                            className="h-6 w-6 rounded-full ring-1 ring-zinc-200 object-cover"
                            onError={(e) => {
                              (
                                e.currentTarget as HTMLImageElement
                              ).style.display = "none";
                            }}
                          />
                        ) : (
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-semibold text-zinc-700">
                            {initialsOf(sup.displayName || sup.email)}
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate">
                          <span
                            className={
                              "font-medium " +
                              (supErr
                                ? "text-red-700 dark:text-red-200"
                                : "text-zinc-800 dark:text-zinc-200")
                            }
                          >
                            {sup.displayName}
                          </span>
                          {supErr ? (
                            <span className="block truncate text-[10px] text-red-600 dark:text-red-300">
                              {supErr}
                            </span>
                          ) : null}
                        </span>
                        <span className="ml-1 flex items-center gap-1 opacity-0 group-hover:opacity-100">
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              void quitarSupervisor(r.displayId);
                            }}
                            onKeyDown={(ev) => {
                              if (
                                (ev.key === "Enter" || ev.key === " ") &&
                                ev.target === ev.currentTarget
                              ) {
                                ev.stopPropagation();
                                void quitarSupervisor(r.displayId);
                              }
                            }}
                            className="inline-flex h-5 w-5 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                            title="Quitar supervisor de esta fila (desasignar)"
                            aria-label="Quitar supervisor"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            >
                              <path
                                d="M6 6l12 12M18 6L6 18"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                          <span className="text-zinc-400">Cambiar</span>
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => abrirSeleccionarSupervisor(r.displayId)}
                        className={
                          "inline-flex h-8 w-full items-center justify-center gap-1 rounded-md border-dashed bg-white text-[11px] font-medium transition-colors " +
                          (supErr
                            ? "border border-red-400 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-950"
                            : "border border-zinc-300 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900")
                        }
                        title={
                          supErr
                            ? "Error al guardar. Click para reintentar seleccionando supervisor."
                            : "Seleccionar supervisor para esta actividad — quedará asignado permanentemente hasta que tú lo cambies"
                        }
                      >
                        {supSaving ? (
                          <svg
                            className="h-3.5 w-3.5 animate-spin"
                            viewBox="0 0 24 24"
                            fill="none"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                            />
                          </svg>
                        ) : (
                          <SupervisorAsignarIcon />
                        )}
                        <span className="hidden md:inline">
                          {supErr ? "Reintentar" : supSaving ? "Guardando…" : "Asignar"}
                        </span>
                      </button>
                    )}
                  </div>

                  <div className="col-span-2 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => tryCrearAsignacionIndividual(r.displayId)}
                      disabled={creando}
                      className={
                        "inline-flex h-8 items-center justify-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors " +
                        (fb?.ok
                          ? "border-emerald-500 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200 dark:hover:bg-emerald-900"
                          : fb && !fb.ok
                            ? "border-red-500 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-700 dark:bg-red-950 dark:text-red-200 dark:hover:bg-red-900"
                            : sup
                              ? "border-emerald-600 bg-white text-emerald-700 hover:bg-emerald-50 dark:border-emerald-600 dark:bg-black dark:text-emerald-400 dark:hover:bg-zinc-900"
                              : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-black dark:text-zinc-300 dark:hover:bg-zinc-900")
                      }
                      title={
                        creando
                          ? "Creando asignación en BD…"
                          : sup
                            ? `Materializar en tabla asignaciones → crea 1 asignación con el supervisor asociado (${sup.displayName}) y fecha límite al último día del mes en curso. El supervisor de la fila NO se modifica.`
                            : "Primero selecciona un supervisor (se abrirá el diálogo)."
                      }
                    >
                      {creando ? (
                        <svg
                          className="h-3.5 w-3.5 animate-spin"
                          viewBox="0 0 24 24"
                          fill="none"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
                        </svg>
                      ) : fb?.ok ? (
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        >
                          <path
                            d="M5 12l5 5L20 7"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : (
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        >
                          <path
                            d="M5 12l5 5L20 7"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                      <span className="hidden md:inline">
                        {creando
                          ? "Creando…"
                          : fb?.ok
                            ? "Creada"
                            : fb && !fb.ok
                              ? "Reintentar"
                              : "Crear"}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const meta = asignacionesCreadas.get(r.displayId);
                        if (meta?.id) {
                          // Vía UPDATE real en BD (asignación existente).
                          setDialog({
                            kind: "editarAsignacion",
                            displayId: r.displayId,
                            assignmentId: meta.id,
                            initialTitle: meta.title,
                            initialDueAtISO: meta.dueAtISO,
                          });
                          return;
                        }

                        // Vía state cliente (antes de crear la asignación).
                        // Se usa al pulsar luego Check o Reasignar marcadas.
                        const pre = getPreOrDefault(r.displayId);
                        setDialog({
                          kind: "preconfigurarFila",
                          displayId: r.displayId,
                          initialTitle: pre.titulo,
                          initialFechaISO: pre.fechaISO,
                        });
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-black dark:text-zinc-300 dark:hover:bg-zinc-900"
                      aria-label="Editar nombre y fecha de entrega"
                      title={
                        asignacionesCreadas.get(r.displayId)?.id
                          ? "Editar la asignación ya creada (UPDATE en BD)"
                          : "Pre-configurar nombre y fecha de entrega (antes de crear la asignación). Se usará luego al darle Check ✓."
                      }
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        aria-hidden="true"
                        className="h-4 w-4"
                      >
                        <path
                          d="M12 20h9"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <path
                          d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5Z"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {modalOpen ? (
        <QuickAsignarFila
          open={true}
          onClose={cerrarDialogo}
          currentUserEmail={currentUserEmail}
          currentUserId={currentUserId}
          mode={modalMode}
          matrizOptions={matrizOptions}
          supervisores={supervisores}
          onCreated={modoMultiActivo ? handleMasivoCreated : undefined}
          selectionOnly={selectionOnly}
          onSupervisorSelected={onSupervisorSelected}
        />
      ) : null}

      {dialog && dialog.kind === "editarAsignacion" ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="editar-asignacion-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) cerrarDialogo();
          }}
        >
          <form
            onSubmit={handleSubmitEditar}
            className="w-full max-w-md overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl outline-none dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="flex items-start justify-between border-b border-zinc-100 px-5 py-3.5 dark:border-zinc-900">
              <div>
                <h2
                  id="editar-asignacion-title"
                  className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
                >
                  Editar asignación
                </h2>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Fila #{dialog.displayId}. Modifica el nombre y la fecha de
                  entrega de la asignación ya creada.
                </p>
              </div>
              <button
                type="button"
                onClick={cerrarDialogo}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
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

            <div className="space-y-4 px-5 py-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Nombre de la asignación
                </label>
                <input
                  type="text"
                  autoFocus
                  value={editarTitulo}
                  onChange={(e) => setEditarTitulo(e.target.value)}
                  className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:border-zinc-600"
                  placeholder="#1 · Revisar facturas…"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Fecha de entrega
                </label>
                <input
                  type="date"
                  value={editarFecha}
                  onChange={(e) => setEditarFecha(e.target.value)}
                  className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:border-zinc-600"
                />
              </div>

              {editarResult?.ok ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                  Cambios guardados correctamente.
                </div>
              ) : editarResult ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                  {editarResult.error}
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-900">
              <button
                type="button"
                onClick={cerrarDialogo}
                disabled={editarSubmitting}
                className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={editarSubmitting}
                className="inline-flex h-9 items-center justify-center rounded-md bg-zinc-900 px-3.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {editarSubmitting ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {dialog && dialog.kind === "preconfigurarFila" ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="preconfigurar-fila-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) cerrarDialogo();
          }}
        >
          <form
            onSubmit={handleSubmitPreconfigurar}
            className="w-full max-w-md overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl outline-none dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="flex items-start justify-between border-b border-zinc-100 px-5 py-3.5 dark:border-zinc-900">
              <div>
                <h2
                  id="preconfigurar-fila-title"
                  className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
                >
                  Pre-configurar fila #{dialog.displayId}
                </h2>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Edita nombre y fecha antes de crear la asignación. Luego al
                  darle Check ✓ o reasignar en lote se usan estos valores.
                </p>
              </div>
              <button
                type="button"
                onClick={cerrarDialogo}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
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

            <div className="space-y-4 px-5 py-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Nombre (título de la asignación)
                </label>
                <input
                  type="text"
                  autoFocus
                  value={preTitulo}
                  onChange={(e) => setPreTitulo(e.target.value)}
                  className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:border-zinc-600"
                  placeholder="#1 · Revisar facturas…"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Fecha límite de entrega
                </label>
                <input
                  type="date"
                  value={preFecha}
                  onChange={(e) => setPreFecha(e.target.value)}
                  className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:border-zinc-600"
                />
              </div>

              {preResult?.ok ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                  Listo. Los valores se usarán al crear la asignación.
                </div>
              ) : preResult ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                  {preResult.error}
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-900">
              <button
                type="button"
                onClick={cerrarDialogo}
                className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="inline-flex h-9 items-center justify-center rounded-md bg-zinc-900 px-3.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Guardar
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
