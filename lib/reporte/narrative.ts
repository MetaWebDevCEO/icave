/**
 * Generación de texto del reporte (resumen ejecutivo, hallazgos y
 * recomendaciones) por reglas y plantillas.
 *
 * REGLA DE ORO: no se inventa nada. Cada enunciado se construye con cifras que
 * vienen del cálculo; si una cifra no existe, el enunciado no se emite.
 */

import { round1, round0 } from "./compliance";
import type { PriorityStat, ReportKpis, SupervisorRow } from "./types";

export interface NarrativeInput {
  /** "octubre 2026" (minúsculas, para redactar). */
  monthLabelLower: string;
  /** "septiembre 2026" (minúsculas) o null si no hay mes anterior. */
  prevMonthLabelLower: string | null;
  parcial: boolean;
  kpis: ReportKpis;
  prevKpis: ReportKpis | null;
  supervisores: SupervisorRow[];
  puntualidad: {
    aTiempo: number;
    extemporaneas: number;
    sinEntregar: number;
    diasPromedioAtraso: number | null;
  };
  actividades: {
    topCumplidas: { actividad: string; total: number; cumplimiento: number }[];
    topAtrasadas: { actividad: string; total: number; atrasadas: number; cumplimiento: number }[];
    noAsignadas: string[];
  };
  prioridad: PriorityStat[];
  /** Evidencia adjunta en las tareas con entrega. */
  evidencia: { entregadas: number; sinEvidencia: number };
  /** Tareas con comentario del revisor que siguen sin completarse. */
  retroalimentacionPendiente: number;
}

/** "68%" o "68.5%" según haga falta precisión. */
function pct(value: number): string {
  const v = round1(value);
  return Number.isInteger(v) ? `${v}%` : `${v.toFixed(1)}%`;
}

function num(value: number): string {
  return String(round0(value));
}

/** "12 puntos más" / "12 puntos menos" / "sin cambio". */
function puntos(delta: number): string {
  const d = round1(Math.abs(delta));
  const valor = Number.isInteger(d) ? `${d}` : d.toFixed(1);
  if (round1(delta) === 0) return "sin cambio";
  return `${valor} puntos ${delta > 0 ? "más" : "menos"}`;
}

function listarNombres(nombres: string[], max = 3): string {
  if (nombres.length <= max) return nombres.join(", ");
  return `${nombres.slice(0, max).join(", ")} y ${nombres.length - max} más`;
}

export function buildResumenEjecutivo(input: NarrativeInput): string[] {
  const { kpis, prevKpis, monthLabelLower, parcial } = input;
  const out: string[] = [];

  if (kpis.total === 0) {
    return [
      `No se registraron asignaciones con actividad en ${monthLabelLower}${
        parcial ? " al corte de este avance parcial" : ""
      }.`,
      "Al no existir tareas en el periodo, no hay indicadores de cumplimiento, puntualidad ni ranking de supervisores que reportar.",
    ];
  }

  // 1. Cumplimiento general (con comparación si hay base).
  if (prevKpis && prevKpis.total > 0 && input.prevMonthLabelLower) {
    const delta = round1(kpis.cumplimiento - prevKpis.cumplimiento);
    out.push(
      `El cumplimiento general de ${monthLabelLower} fue de ${pct(kpis.cumplimiento)}, ${puntos(
        delta
      )} que ${input.prevMonthLabelLower}, que cerró en ${pct(prevKpis.cumplimiento)}.`
    );
  } else {
    out.push(
      `El cumplimiento general de ${monthLabelLower} fue de ${pct(
        kpis.cumplimiento
      )}; no existe base comparable del mes anterior (sin asignaciones registradas).`
    );
  }

  // 2. Volumen y composición.
  out.push(
    `Se registraron ${num(kpis.total)} asignaciones: ${num(kpis.completadas)} completadas en plazo, ${num(
      kpis.extemporaneas
    )} completadas de forma extemporánea, ${num(kpis.entregadas)} entregadas y en revisión, y ${num(
      kpis.pendientes
    )} pendientes al corte.`
  );

  // 3. Atrasadas.
  if (kpis.atrasadas > 0) {
    const p = kpis.total > 0 ? round1((kpis.atrasadas / kpis.total) * 100) : 0;
    out.push(
      `Al corte quedaron ${num(kpis.atrasadas)} tareas atrasadas, equivalentes al ${pct(
        p
      )} del total asignado.`
    );
  } else {
    out.push("Al corte no quedaron tareas atrasadas: todas las asignaciones con fecha límite vencida fueron atendidas.");
  }

  // 4. Ranking (mejor y peor desempeño).
  const conDatos = input.supervisores.filter((s) => s.total > 0);
  if (conDatos.length >= 2) {
    const mejor = conDatos[0];
    const peor = conDatos[conDatos.length - 1];
    out.push(
      `El mejor desempeño correspondió a ${mejor.nombre} con ${pct(mejor.cumplimiento)} (${num(
        mejor.total
      )} tareas); el más bajo fue ${peor.nombre} con ${pct(peor.cumplimiento)} (${num(peor.total)} tareas).`
    );
  } else if (conDatos.length === 1) {
    const unico = conDatos[0];
    out.push(
      `Sólo ${unico.nombre} tuvo tareas asignadas en el periodo, con ${pct(unico.cumplimiento)} de cumplimiento sobre ${num(
        unico.total
      )} tareas.`
    );
  }

  // 5. Semáforo de supervisores.
  if (conDatos.length > 0) {
    const optimo = conDatos.filter((s) => s.semaforo === "optimo").length;
    const riesgo = conDatos.filter((s) => s.semaforo === "riesgo").length;
    const critico = conDatos.filter((s) => s.semaforo === "critico").length;
    out.push(
      `De ${num(conDatos.length)} supervisores con carga, ${num(optimo)} están en estado óptimo (≥75%), ${num(
        riesgo
      )} en riesgo (50–74%) y ${num(critico)} en estado crítico (<50%).`
    );
  }

  // 6. Puntualidad.
  const entregas = input.puntualidad.aTiempo + input.puntualidad.extemporaneas;
  if (entregas > 0) {
    const aTiempoPct = round1((input.puntualidad.aTiempo / entregas) * 100);
    const atraso =
      input.puntualidad.diasPromedioAtraso !== null
        ? `, con un atraso promedio de ${round1(input.puntualidad.diasPromedioAtraso)} días`
        : "";
    out.push(
      `De las ${num(entregas)} tareas completadas, el ${pct(
        aTiempoPct
      )} se entregó dentro del plazo y ${num(input.puntualidad.extemporaneas)} fuera de él${atraso}.`
    );
  } else if (kpis.total > 0) {
    out.push("Ninguna tarea fue completada en el periodo, por lo que no hay medición de puntualidad de entrega.");
  }

  // 7. Prioridad urgente vs no urgente.
  const urgentes = input.prioridad.filter((p) => p.prioridad === "Urgente");
  const noUrgentes = input.prioridad.filter((p) => p.prioridad !== "Urgente");
  if (urgentes.length > 0 && noUrgentes.length > 0) {
    const u = urgentes[0];
    const totalNoUrg = noUrgentes.reduce((a, p) => a + p.total, 0);
    const compNoUrg = noUrgentes.reduce((a, p) => a + p.completadas, 0);
    const noUrgPct = totalNoUrg > 0 ? round1((compNoUrg / totalNoUrg) * 100) : 0;
    out.push(
      `Las actividades marcadas como Urgente alcanzaron ${pct(u.cumplimiento)} de cumplimiento (${num(
        u.total
      )} tareas), frente al ${pct(noUrgPct)} de las no urgentes (${num(totalNoUrg)} tareas).`
    );
  }

  return out.slice(0, 6);
}

export function buildHallazgos(input: NarrativeInput): string[] {
  const { kpis, supervisores, puntualidad } = input;
  const out: string[] = [];

  if (kpis.total === 0) {
    return ["Sin asignaciones registradas en el periodo no es posible derivar hallazgos."];
  }

  const conDatos = supervisores.filter((s) => s.total > 0);
  const promedio = kpis.cumplimiento;

  // Sobrecarga de volumen en un supervisor.
  if (conDatos.length >= 2) {
    const mayor = [...conDatos].sort((a, b) => b.total - a.total)[0];
    const cuota = round1((mayor.total / kpis.total) * 100);
    if (mayor.total >= 3 && cuota >= 20) {
      out.push(
        `Carga concentrada: ${mayor.nombre} acumuló ${num(mayor.total)} tareas (${pct(
          cuota
        )} del total del mes) y su cumplimiento fue ${pct(mayor.cumplimiento)}, ${puntos(
          round1(mayor.cumplimiento - promedio)
        )} que el promedio general (${pct(promedio)}).`
      );
    }
  }

  // Evidencia faltante.
  if (input.evidencia.entregadas > 0 && input.evidencia.sinEvidencia > 0) {
    const p = round1((input.evidencia.sinEvidencia / input.evidencia.entregadas) * 100);
    out.push(
      `Entregas sin evidencia: ${num(input.evidencia.sinEvidencia)} de ${num(
        input.evidencia.entregadas
      )} tareas entregadas (${pct(
        p
      )}) no adjuntaron archivo de respaldo, lo que impide validar la ejecución sin trabajo adicional del revisor.`
    );
  }

  // Retroalimentación sin atender.
  if (input.retroalimentacionPendiente > 0) {
    const p = round1((input.retroalimentacionPendiente / kpis.total) * 100);
    out.push(
      `Retroalimentación sin atender: ${num(
        input.retroalimentacionPendiente
      )} tareas devueltas por el revisor continuaban sin completarse al corte (${pct(
        p
      )} del total), es decir, el ciclo de corrección no se cerró.`
    );
  }

  // Actividades atrasadas de forma recurrente.
  const recurrente = input.actividades.topAtrasadas[0];
  if (recurrente && recurrente.atrasadas > 0) {
    const p = kpis.atrasadas > 0 ? round1((recurrente.atrasadas / kpis.atrasadas) * 100) : 0;
    out.push(
      `Atraso recurrente: la actividad «${recurrente.actividad}» acumuló ${num(
        recurrente.atrasadas
      )} atrasos (${pct(p)} de los ${num(kpis.atrasadas)} atrasos del mes) con un cumplimiento de ${pct(
        recurrente.cumplimiento
      )} sobre ${num(recurrente.total)} tareas.`
    );
  }

  // Prioridad declarada vs ejecución.
  const urgentes = input.prioridad.filter((p) => p.prioridad === "Urgente");
  const noUrgentes = input.prioridad.filter((p) => p.prioridad !== "Urgente");
  if (urgentes.length > 0 && noUrgentes.length > 0) {
    const u = urgentes[0];
    const totalNoUrg = noUrgentes.reduce((a, p) => a + p.total, 0);
    const compNoUrg = noUrgentes.reduce((a, p) => a + p.completadas, 0);
    const noUrgPct = totalNoUrg > 0 ? round1((compNoUrg / totalNoUrg) * 100) : 0;
    if (u.cumplimiento < noUrgPct) {
      out.push(
        `Desalineación de prioridades: las tareas Urgente tuvieron menor cumplimiento (${pct(
          u.cumplimiento
        )}, ${num(u.total)} tareas) que las no urgentes (${pct(noUrgPct)}, ${num(
          totalNoUrg
        )} tareas), por lo que la etiqueta de urgencia no se tradujo en ejecución.`
      );
    }
  }

  // Concentración de atrasos.
  if (kpis.atrasadas > 0 && conDatos.length >= 3) {
    const porAtraso = [...conDatos].filter((s) => s.atrasadas > 0).sort((a, b) => b.atrasadas - a.atrasadas);
    const acumulado = porAtraso.slice(0, 2).reduce((a, s) => a + s.atrasadas, 0);
    if (acumulado / kpis.atrasadas >= 0.5 && porAtraso.length >= 2) {
      const p = round1((acumulado / kpis.atrasadas) * 100);
      out.push(
        `Concentración de atrasos: ${num(acumulado)} de los ${num(
          kpis.atrasadas
        )} atrasos (${pct(p)}) se explican por ${listarNombres(
          porAtraso.slice(0, 2).map((s) => s.nombre),
          2
        )}, lo que sugiere un problema localizado y no sistémico.`
      );
    }
  }

  // Magnitud del atraso.
  if (puntualidad.extemporaneas > 0 && puntualidad.diasPromedioAtraso !== null) {
    out.push(
      `Magnitud del atraso: las ${num(
        puntualidad.extemporaneas
      )} tareas completadas fuera de plazo promediaron ${round1(
        puntualidad.diasPromedioAtraso
      )} días de retraso respecto a su fecha límite.`
    );
  }

  // Actividades de la matriz sin cobertura.
  if (input.actividades.noAsignadas.length > 0) {
    out.push(
      `Cobertura incompleta: ${num(
        input.actividades.noAsignadas.length
      )} actividades de la matriz no registraron ninguna asignación en el mes (p. ej. ${listarNombres(
        input.actividades.noAsignadas,
        3
      )}), por lo que no hay evidencia de su ejecución.`
    );
  }

  // Mejor práctica.
  if (conDatos.length >= 2 && conDatos[0].cumplimiento > promedio) {
    const mejor = conDatos[0];
    out.push(
      `Práctica replicable: ${mejor.nombre} alcanzó ${pct(mejor.cumplimiento)} con ${num(
        mejor.total
      )} tareas asignadas, ${puntos(
        round1(mejor.cumplimiento - promedio)
      )} que el promedio general (${pct(promedio)}).`
    );
  }

  if (out.length === 0) {
    out.push(
      `Sin hallazgos negativos relevantes: el cumplimiento del mes fue ${pct(
        promedio
      )} con ${num(kpis.atrasadas)} tareas atrasadas al corte.`
    );
  }

  return out;
}

export function buildRecomendaciones(input: NarrativeInput): string[] {
  const { kpis, supervisores } = input;
  const out: string[] = [];

  if (kpis.total === 0) {
    return ["Verificar la asignación de actividades del periodo antes de generar el siguiente reporte."];
  }

  const criticos = supervisores.filter((s) => s.semaforo === "critico");
  const riesgo = supervisores.filter((s) => s.semaforo === "riesgo");

  if (criticos.length > 0) {
    const tareas = criticos.reduce((a, s) => a + s.pendientes + s.atrasadas, 0);
    out.push(
      `Programar una sesión de seguimiento con los ${num(criticos.length)} supervisores en estado crítico (${listarNombres(
        criticos.map((s) => s.nombre)
      )}) para revisar sus ${num(tareas)} tareas pendientes y atrasadas.`
    );
  } else if (riesgo.length > 0) {
    out.push(
      `Dar seguimiento quincenal a los ${num(riesgo.length)} supervisores en riesgo (${listarNombres(
        riesgo.map((s) => s.nombre)
      )}) para evitar que caigan por debajo del 50% de cumplimiento.`
    );
  }

  if (input.evidencia.sinEvidencia > 0 && input.evidencia.entregadas > 0) {
    const p = round1((input.evidencia.sinEvidencia / input.evidencia.entregadas) * 100);
    out.push(
      `Hacer obligatoria la evidencia adjunta al momento de la entrega: el ${pct(
        p
      )} de las entregas del mes (${num(input.evidencia.sinEvidencia)} de ${num(
        input.evidencia.entregadas
      )}) no incluyó respaldo.`
    );
  }

  if (input.retroalimentacionPendiente > 0) {
    out.push(
      `Definir un plazo máximo de 2 días para atender la retroalimentación del revisor y cerrar el ciclo de corrección: hay ${num(
        input.retroalimentacionPendiente
      )} tareas devueltas sin completar.`
    );
  }

  if (input.actividades.noAsignadas.length > 0) {
    out.push(
      `Asignar responsable a las ${num(
        input.actividades.noAsignadas.length
      )} actividades de la matriz sin cobertura en el mes (p. ej. ${listarNombres(
        input.actividades.noAsignadas,
        3
      )}).`
    );
  }

  const urgentes = input.prioridad.filter((p) => p.prioridad === "Urgente");
  if (urgentes.length > 0 && noUrgenteMenorQueUrgente(input)) {
    out.push(
      `Revisar la política de prioridades: las tareas Urgente cerraron en ${pct(
        urgentes[0].cumplimiento
      )}, por debajo de las no urgentes, lo que indica que la urgencia no se refleja en la planeación semanal.`
    );
  }

  if (kpis.extemporaneas > 0) {
    out.push(
      `Reforzar la planeación de fechas límite: ${num(
        kpis.extemporaneas
      )} de ${num(kpis.total)} tareas (${pct(
        round1((kpis.extemporaneas / kpis.total) * 100)
      )}) se completaron después de su fecha límite.`
    );
  }

  const conDatos = supervisores.filter((s) => s.total > 0);
  if (conDatos.length >= 2 && conDatos[0].cumplimiento >= 75) {
    const mejor = conDatos[0];
    out.push(
      `Documentar y replicar el método de ${mejor.nombre} (${pct(
        mejor.cumplimiento
      )} de cumplimiento con ${num(mejor.total)} tareas) en una sesión de transferencia de prácticas.`
    );
  }

  if (out.length === 0) {
    out.push(
      `Mantener el esquema de seguimiento vigente: el cumplimiento del mes fue ${pct(
        kpis.cumplimiento
      )} sin supervisores en estado crítico.`
    );
  }

  return out.slice(0, 5);
}

function noUrgenteMenorQueUrgente(input: NarrativeInput): boolean {
  const urgentes = input.prioridad.filter((p) => p.prioridad === "Urgente");
  const noUrgentes = input.prioridad.filter((p) => p.prioridad !== "Urgente");
  if (urgentes.length === 0 || noUrgentes.length === 0) return false;
  const totalNoUrg = noUrgentes.reduce((a, p) => a + p.total, 0);
  const compNoUrg = noUrgentes.reduce((a, p) => a + p.completadas, 0);
  const noUrgPct = totalNoUrg > 0 ? round1((compNoUrg / totalNoUrg) * 100) : 0;
  return urgentes[0].cumplimiento < noUrgPct;
}
