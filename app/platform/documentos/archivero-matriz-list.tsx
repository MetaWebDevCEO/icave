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
import {
  setMatrizSupervisor,
  deleteMatrizActividad,
  createMatrizActividad,
  updateMatrizActividad,
} from "./matriz-supervisor-actions";
import { sileo } from "sileo";
import { useRouter } from "next/navigation";

export type FilaMatriz = {
  id: string;
  displayId: number;
  actividad: string;
  frecuencia: string;
  created_at: string | null;
};

/**
 * Asignación materializada desde una fila de la matriz.
 * key del Map = displayId de la fila de matriz (NO el assignmentId).
 */
export type AsignacionCreadaMeta = {
  id: string;
  title: string;
  dueAtISO: string;
  status?: string | null;
  supervisorEmail?: string | null;
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
  initialAsignacionesCreadas: Map<number, AsignacionCreadaMeta>;
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
  | { kind: "crearAsignacionFila"; displayId: number }
  | { kind: "nuevaActividad" }
  | { kind: "reasignarMasivo" }
  | {
      kind: "editarFila";
      displayId: number;
      /** id de la asignación creada desde la fila (null si aún no existe). */
      assignmentId: string | null;
      /** Nombre actual de la actividad en la matriz. */
      initialActividad: string;
      /** Fecha de entrega de la asignación o de la pre-configuración. */
      initialFechaISO: string;
    }
  | {
      kind: "confirmarEliminarFila";
      displayId: number;
      actividad: string;
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
    initialAsignacionesCreadas,
  } = props;

  const [dialog, setDialog] = React.useState<DialogKind>(null);
  const [checked, setChecked] = React.useState<Set<number>>(new Set());
  /**
   * Asociación persistente en cliente. Se inicializa desde DB (prop
   * `initialSupervisoresAsignados`) y se actualiza:
   * - Optimista cuando el usuario elige/quita un supervisor.
   * - Se persiste en background via `setMatrizSupervisor`.
   * - Si falla la persistencia, se hace REVERT al valor anterior y se
   *   notifica el error con un toast.
   * Esta asociación NUNCA se modifica por crear la asignación (Check).
   * Solo cambia cuando el usuario pulsa "Cambiar" o "Quitar" en el chip.
   */
  const [supervisorPorFila, setSupervisorPorFila] = React.useState<
    Map<number, SupervisorOption>
  >(new Map(initialSupervisoresAsignados));
  const [savingSupervisors, setSavingSupervisors] = React.useState<
    Set<number>
  >(new Set());

  const [creatingIds, setCreatingIds] = React.useState<Set<number>>(new Set());

  /**
   * Asignaciones ya creadas por fila. Se inicializa desde BD (prop
   * `initialAsignacionesCreadas`, que lee el marcador `[Matriz] #N` de la
   * descripción) para que sobreviva a un F5, y se actualiza de forma
   * optimista al crear/editar desde aquí.
   * key = displayId de la fila de matriz (NO el assignmentId)
   */
  const [asignacionesCreadas, setAsignacionesCreadas] = React.useState<
    Map<number, AsignacionCreadaMeta>
  >(new Map(initialAsignacionesCreadas));

  /** Local primero (optimista), luego lo que vino de la BD. */
  const getAsignacionCreada = React.useCallback(
    (displayId: number): AsignacionCreadaMeta | null => {
      if (displayId < 1) return null;
      const local = asignacionesCreadas.get(displayId);
      if (local) return local;
      return initialAsignacionesCreadas.get(displayId) ?? null;
    },
    [asignacionesCreadas, initialAsignacionesCreadas]
  );

  /** Nombre del supervisor a partir del correo con el que se creó la tarea. */
  const getSupervisorNombre = React.useCallback(
    (email: string | null | undefined): string | null => {
      if (!email) return null;
      const normalized = email.trim().toLowerCase();
      if (!normalized) return null;
      const found = supervisores.find(
        (s) => (s.email ?? "").trim().toLowerCase() === normalized
      );
      return found?.displayName ?? email;
    },
    [supervisores]
  );

  /**
   * Datos por fila (título de la asignación + fecha límite) que se usan al:
   *   1) seleccionar supervisor, 2) pulsar Check, o 3) pulsar "Reasignar marcadas".
   * Los fija el diálogo "Editar actividad" y también se derivan de la matriz
   * cuando el usuario NO los ha configurado:
   *   - titulo = #id · actividad (o Actividad #id sin nombre)
   *   - fecha  = último día del mes en curso.
   * Esta asociación es state de cliente → sobrevive renders (mientras no F5).
   * Si pulsas Check, se materializa la asignación con estos valores.
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

  // ---- Formulario EDITAR FILA (nombre de la actividad + fecha de entrega) ----
  const [editarActividad, setEditarActividad] = React.useState<string>("");
  const [editarFecha, setEditarFecha] = React.useState<string>("");
  const [editarSubmitting, setEditarSubmitting] = React.useState<boolean>(false);

  // ---- Eliminar actividad de una fila de la matriz ----
  const [eliminando, setEliminando] = React.useState<boolean>(false);
  const router = useRouter();

  // ---- Nueva actividad en la matriz (solo el nombre) ----
  const [nuevaActividadNombre, setNuevaActividadNombre] =
    React.useState<string>("");
  const [creandoActividad, setCreandoActividad] = React.useState<boolean>(false);

  // Cuando se abre el dialog de edición, inicializar inputs.
  const abrirEditarFila = (params: {
    displayId: number;
    assignmentId: string | null;
    actividad: string;
    fechaISO: string;
  }) => {
    setEditarActividad(params.actividad);
    setEditarFecha(params.fechaISO.slice(0, 10));
    setDialog({
      kind: "editarFila",
      displayId: params.displayId,
      assignmentId: params.assignmentId,
      initialActividad: params.actividad,
      initialFechaISO: params.fechaISO,
    });
  };

  async function handleSubmitEditar(e: React.FormEvent) {
    e.preventDefault();
    if (!dialog || dialog.kind !== "editarFila") return;
    if (editarSubmitting) return;

    const nombre = editarActividad.trim().replace(/\s+/g, " ");
    if (!nombre.length) {
      sileo.error({
        title: "Nombre requerido",
        description: "El nombre de la actividad no puede quedar vacío.",
      });
      return;
    }
    if (!editarFecha) {
      sileo.error({
        title: "Fecha requerida",
        description: "Selecciona fecha de entrega.",
      });
      return;
    }

    const displayId = dialog.displayId;
    const assignmentId = dialog.assignmentId;
    const fechaISO = `${editarFecha}T00:00:00.000Z`;

    setEditarSubmitting(true);

    try {
      // 1) El nombre se guarda en la MATRIZ (catálogo del Archivero).
      const m = await updateMatrizActividad({ displayId, actividad: nombre });
      if (!m.ok) {
        sileo.error({
          title: "No se pudo guardar el nombre",
          description: m.error,
        });
        return;
      }

      // 2) Si ya existe la asignación, se sincronizan título y fecha.
      if (assignmentId) {
        const r: UpdateAssignmentBasicsResult = await updateAssignmentBasics({
          assignmentId,
          nuevoTitulo: `#${displayId} · ${nombre}`,
          nuevaFechaEntregaISO: fechaISO,
        });

        if (!r.ok) {
          sileo.error({
            title: "No se pudieron guardar los cambios",
            description: r.error,
          });
          return;
        }

        const prevMeta = getAsignacionCreada(displayId);
        setAsignacionesCreadas((prev) => {
          const n = new Map(prev);
          n.set(displayId, {
            id: assignmentId,
            title: r.title,
            dueAtISO: r.due_at,
            status: prevMeta?.status ?? "pendiente",
            supervisorEmail: prevMeta?.supervisorEmail ?? null,
          });
          return n;
        });
      }

      // La pre-configuración queda alineada con lo recién guardado.
      setPrePorFila((prev) => {
        const n = new Map(prev);
        n.set(displayId, {
          titulo: `#${displayId} · ${nombre}`,
          fechaISO,
        });
        return n;
      });

      sileo.success({
        title: "Actividad actualizada",
        description: `Fila #${displayId} · ${nombre}`,
      });
      setDialog(null);
      router.refresh();
    } catch (err) {
      sileo.error({
        title: "Error al guardar",
        description:
          err instanceof Error ? err.message : "Error desconocido al guardar.",
      });
    } finally {
      setEditarSubmitting(false);
    }
  }

  /**
   * Crea la actividad en la MATRIZ: sólo se guarda el nombre.
   * No se pide supervisor ni fecha y no se crea nada en Task/asignaciones.
   * El supervisor y la fecha de expiración se ponen después, ya en la fila.
   */
  async function handleSubmitNuevaActividad(e: React.FormEvent) {
    e.preventDefault();
    if (creandoActividad) return;

    const nombre = nuevaActividadNombre.trim().replace(/\s+/g, " ");
    if (!nombre) {
      sileo.error({
        title: "Falta el nombre",
        description: "Escribe el nombre de la actividad.",
      });
      return;
    }

    setCreandoActividad(true);
    try {
      const r = await createMatrizActividad({ actividad: nombre });
      if (!r.ok) {
        sileo.error({
          title: "No se pudo crear la actividad",
          description: r.error,
        });
        return;
      }

      sileo.success({
        title: "Actividad creada en la matriz",
        description: `Fila #${r.id} · ${nombre}`,
      });
      setNuevaActividadNombre("");
      setDialog(null);
      router.refresh();
    } catch (err) {
      sileo.error({
        title: "Error al crear",
        description:
          err instanceof Error ? err.message : "Error desconocido al crear.",
      });
    } finally {
      setCreandoActividad(false);
    }
  }

  async function handleConfirmarEliminar() {
    if (!dialog || dialog.kind !== "confirmarEliminarFila") return;
    if (eliminando) return;

    const displayId = dialog.displayId;
    setEliminando(true);

    try {
      const r = await deleteMatrizActividad({ displayId });
      if (!r.ok) {
        sileo.error({
          title: "No se pudo eliminar la actividad",
          description: r.error,
        });
        return;
      }

      // Limpiar estado local de la fila para que no quede residuo.
      setChecked((prev) => {
        if (!prev.has(displayId)) return prev;
        const n = new Set(prev);
        n.delete(displayId);
        return n;
      });
      setPrePorFila((prev) => {
        if (!prev.has(displayId)) return prev;
        const n = new Map(prev);
        n.delete(displayId);
        return n;
      });
      setAsignacionesCreadas((prev) => {
        if (!prev.has(displayId)) return prev;
        const n = new Map(prev);
        n.delete(displayId);
        return n;
      });

      sileo.success({
        title: "Actividad eliminada",
        description:
          r.asignacionesEliminadas > 0
            ? `Se eliminó la fila #${displayId}, la asignación creada y sus evidencias.`
            : `La fila #${displayId} quedó vacía.`,
      });
      setDialog(null);
      router.refresh();
    } catch (err) {
      sileo.error({
        title: "Error al eliminar",
        description:
          err instanceof Error ? err.message : "Error desconocido al eliminar.",
      });
    } finally {
      setEliminando(false);
    }
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
  function abrirCrearAsignacionFila(displayId: number) {
    setDialog({ kind: "crearAsignacionFila", displayId });
  }
  function abrirNuevaActividad() {
    setNuevaActividadNombre("");
    setDialog({ kind: "nuevaActividad" });
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
   * QuickAsignarFila, modo selección) también se entere y notifique el
   * detalle con un toast. Sin esto, el Modal pensaba que todo era OK y
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
      sileo.error({
        title: "No se pudo guardar el supervisor",
        description: lastError,
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
   * Permite al modal esperar la persistencia real antes de cerrarse.
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

  async function handleQuickCreated(result: {
    ok: true;
    ids: string[];
    count: number;
    displayIds: number[];
    supervisors: SupervisorOption[];
    assigningToAll: boolean;
  }) {
    if (
      result.displayIds.length === 1 &&
      result.supervisors.length === 1 &&
      !result.assigningToAll
    ) {
      const displayId = result.displayIds[0]!;
      const supervisor = result.supervisors[0]!;
      const current = supervisorDeFila(displayId);
      if (
        !current ||
        (current.userId ?? current.id) !== (supervisor.userId ?? supervisor.id)
      ) {
        await persistirSupervisor(displayId, supervisor, current);
      }
    }
    setChecked(new Set());
    setDialog(null);
    router.refresh();
  }

  /**
   * Crea LA ASIGNACIÓN en BD para una sola fila (botón Check ✓).
   * Si esa fila NO tiene supervisor asociado → abre el modal de selección primero.
   */
  async function tryCrearAsignacionIndividual(displayId: number) {
    const supervisor = supervisorDeFila(displayId);
    if (!supervisor?.email) {
      abrirCrearAsignacionFila(displayId);
      return;
    }

    const pre = getPreOrDefault(displayId);
    const titulo = pre.titulo.trim().length > 0 ? pre.titulo : `Actividad #${displayId}`;
    const fechaISO = pre.fechaISO ? toISOAtMidnight(new Date(pre.fechaISO)) : toISOAtMidnight(ultimoDiaMesEnCurso());

    try {
      setCreatingIds((prev) => new Set(prev).add(displayId));

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
        matrizFilaId: displayId,
      });

      if (r.ok) {
        setAsignacionesCreadas((prev) => {
          const n = new Map(prev);
          n.set(displayId, {
            id: r.id,
            title: titulo,
            dueAtISO: fechaISO,
            status: "pendiente",
            supervisorEmail: supervisor.email,
          });
          return n;
        });
        sileo.success({
          title: "Asignación creada",
          description: `Fila #${displayId} · ${titulo}`,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "No se pudo crear la asignación",
          description: r.error,
        });
      }
    } catch (err) {
      sileo.error({
        title: "Error al crear la asignación",
        description: err instanceof Error ? err.message : "Error desconocido.",
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
  const modoSelActivo = dialog?.kind === "seleccionarSupervisor";
  const modoCrearFilaActivo = dialog?.kind === "crearAsignacionFila";

  let modalMode: ModalMode = { kind: "multiples", actividades: [] };
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
  } else if (modoCrearFilaActivo) {
    const displayId = dialog.displayId;
    const actividad =
      matrizOptions.find((m) => m.id === displayId) ??
      (() => {
        const r = safeRows.find((rr) => rr.displayId === displayId);
        return { id: displayId, actividad: r?.actividad ?? "" };
      })();
    modalMode = { kind: "fila", actividad };
  } else if (modoMultiActivo) {
    modalMode = { kind: "multiples", actividades: actividadesSeleccionadas };
  }

  const modalOpen = modoSelActivo || modoMultiActivo || modoCrearFilaActivo;

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
              onClick={abrirNuevaActividad}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              title="Agregar una actividad nueva al catálogo de la matriz (solo el nombre)"
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
              Nueva actividad
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
              const supSaving = savingSupervisors.has(r.displayId);
              const asigCreada =
                r.actividad.length > 0 ? getAsignacionCreada(r.displayId) : null;
              const asigSupervisorNombre = asigCreada
                ? getSupervisorNombre(asigCreada.supervisorEmail)
                : null;

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

                  <div className="col-span-7 min-w-0">
                    <div
                      className="truncate font-medium leading-snug text-zinc-950 dark:text-zinc-50"
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
                    </div>

                    {asigCreada ? (
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                        <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400">
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            aria-hidden="true"
                            className="h-2.5 w-2.5"
                          >
                            <path
                              d="M5 12l5 5L20 7"
                              stroke="currentColor"
                              strokeWidth="3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          Ya creada
                        </span>
                        <span
                          className="max-w-[20rem] truncate"
                          title={asigCreada.title}
                        >
                          {asigCreada.title}
                        </span>
                        <span className="text-zinc-300 dark:text-zinc-700">
                          ·
                        </span>
                        <span className="tabular-nums">
                          {formatCalendarDateShort(asigCreada.dueAtISO)}
                        </span>
                        {asigSupervisorNombre ? (
                          <>
                            <span className="text-zinc-300 dark:text-zinc-700">
                              ·
                            </span>
                            <span
                              className="max-w-[14rem] truncate"
                              title={asigCreada.supervisorEmail ?? undefined}
                            >
                              {asigSupervisorNombre}
                            </span>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="col-span-2">
                    {sup ? (
                      <button
                        type="button"
                        onClick={() => abrirSeleccionarSupervisor(r.displayId)}
                        className={
                          "group flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors " +
                          "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-black dark:text-zinc-300 dark:hover:bg-zinc-900"
                        }
                        title={`Cambiar supervisor asignado (actual: ${sup.displayName}) — se mantiene aunque cambies de mes, recargues o cierres sesión`}
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
                            referrerPolicy="no-referrer"
                            crossOrigin="anonymous"
                            loading="lazy"
                            decoding="async"
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
                          <span className="font-medium text-zinc-800 dark:text-zinc-200">
                            {sup.displayName}
                          </span>
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
                        onClick={() => abrirCrearAsignacionFila(r.displayId)}
                        className={
                          "inline-flex h-8 w-full items-center justify-center gap-1 rounded-md border-dashed bg-white text-[11px] font-medium transition-colors " +
                          "border border-zinc-300 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
                        }
                        title="Crear una tarea desde esta fila y elegir un supervisor específico o todos los supervisores"
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
                          {supSaving ? "Guardando…" : "Asignar"}
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
                        (sup
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
                        {creando ? "Creando…" : "Crear"}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const meta = getAsignacionCreada(r.displayId);
                        if (meta?.id) {
                          // Ya existe la asignación: también se sincroniza su
                          // título y fecha además del nombre en la matriz.
                          abrirEditarFila({
                            displayId: r.displayId,
                            assignmentId: meta.id,
                            actividad: r.actividad,
                            fechaISO: meta.dueAtISO,
                          });
                          return;
                        }

                        // Todavía sin asignación: se edita el nombre en la
                        // matriz y la fecha que se usará al crearla.
                        abrirEditarFila({
                          displayId: r.displayId,
                          assignmentId: null,
                          actividad: r.actividad,
                          fechaISO: getPreOrDefault(r.displayId).fechaISO,
                        });
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-black dark:text-zinc-300 dark:hover:bg-zinc-900"
                      aria-label="Editar actividad"
                      title={
                        getAsignacionCreada(r.displayId)?.id
                          ? "Editar la actividad: nombre en la matriz, título y fecha de la asignación creada"
                          : "Editar la actividad: nombre en la matriz y fecha de entrega"
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

                    <button
                      type="button"
                      onClick={() =>
                        setDialog({
                          kind: "confirmarEliminarFila",
                          displayId: r.displayId,
                          actividad: r.actividad,
                        })
                      }
                      disabled={r.actividad.length === 0}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-white disabled:text-zinc-300 dark:border-zinc-800 dark:bg-black dark:text-zinc-300 dark:hover:border-red-900 dark:hover:bg-red-950/40 dark:hover:text-red-400 dark:disabled:border-zinc-800 dark:disabled:bg-black dark:disabled:text-zinc-700"
                      aria-label="Eliminar actividad de la fila"
                      title={
                        r.actividad.length === 0
                          ? "La fila ya está vacía"
                          : `Eliminar la actividad de la fila #${r.displayId} (deja la fila vacía)`
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
                          d="M4 7h16"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <path
                          d="M10 11v6M14 11v6"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <path
                          d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"
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
          onCreated={
            modoMultiActivo || modoCrearFilaActivo ? handleQuickCreated : undefined
          }
          selectionOnly={selectionOnly}
          onSupervisorSelected={onSupervisorSelected}
        />
      ) : null}

      {dialog && dialog.kind === "nuevaActividad" ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="nueva-actividad-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !creandoActividad) cerrarDialogo();
          }}
        >
          <form
            onSubmit={handleSubmitNuevaActividad}
            className="w-full max-w-md overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl outline-none dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="border-b border-zinc-100 px-5 py-3.5 dark:border-zinc-900">
              <h2
                id="nueva-actividad-title"
                className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
              >
                Nueva actividad
              </h2>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Se agrega al catálogo de la matriz. Solo requiere el nombre: el
                supervisor y la fecha de expiración se asignan después, desde la
                fila.
              </p>
            </div>

            <div className="px-5 py-4">
              <label
                htmlFor="nueva-actividad-nombre"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Nombre de la actividad
              </label>
              <input
                id="nueva-actividad-nombre"
                type="text"
                autoFocus
                required
                value={nuevaActividadNombre}
                onChange={(e) => setNuevaActividadNombre(e.target.value)}
                placeholder="Ej: Revisión de extintores"
                className="mt-1 h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:placeholder:text-zinc-600"
              />
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-900">
              <button
                type="button"
                onClick={cerrarDialogo}
                disabled={creandoActividad}
                className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={creandoActividad}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-zinc-900 px-3.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                {creandoActividad ? (
                  <>
                    <svg
                      className="h-3.5 w-3.5 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
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
                    Agregando…
                  </>
                ) : (
                  "Agregar a la matriz"
                )}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {dialog && dialog.kind === "editarFila" ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="editar-actividad-title"
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
                  id="editar-actividad-title"
                  className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
                >
                  Editar actividad
                </h2>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Fila #{dialog.displayId}.{" "}
                  {dialog.assignmentId
                    ? "El nombre se guarda en la matriz y se sincroniza el título y la fecha de la asignación creada."
                    : "El nombre se guarda en la matriz; la fecha se usará al crear la asignación."}
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
                  Nombre de la actividad
                </label>
                <input
                  type="text"
                  autoFocus
                  value={editarActividad}
                  onChange={(e) => setEditarActividad(e.target.value)}
                  className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:border-zinc-600"
                  placeholder="Revisar facturas…"
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

      {dialog && dialog.kind === "confirmarEliminarFila" ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="eliminar-fila-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !eliminando) cerrarDialogo();
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl outline-none dark:border-zinc-800 dark:bg-zinc-950">
            <div className="border-b border-zinc-100 px-5 py-3.5 dark:border-zinc-900">
              <h2
                id="eliminar-fila-title"
                className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
              >
                Eliminar actividad
              </h2>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Se eliminará la fila #{dialog.displayId} de la matriz y, si ya
                tenía asignación creada, también la tarea del supervisor junto
                con sus evidencias. Esta acción no se puede deshacer.
              </p>
            </div>

            <div className="px-5 py-4">
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                {dialog.actividad.length > 0 ? dialog.actividad : "—"}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-900">
              <button
                type="button"
                onClick={cerrarDialogo}
                disabled={eliminando}
                className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmarEliminar}
                disabled={eliminando}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-red-600 px-3.5 text-xs font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {eliminando ? (
                  <>
                    <svg
                      className="h-3.5 w-3.5 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
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
                    Eliminando…
                  </>
                ) : (
                  "Eliminar"
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
