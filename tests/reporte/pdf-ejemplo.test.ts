/**
 * Genera un PDF de ejemplo del "Reporte Mensual de Cierre" con datos de prueba
 * deterministas. Sirve además como prueba de humo del renderizador: si la
 * plantilla o las gráficas se rompen, este test falla.
 *
 * Salida: `reporte-mensual-ejemplo.pdf` en la raíz del proyecto.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildMonthlyReport } from "@/lib/reporte/monthly-report";
import { renderMonthlyReportPdf } from "@/lib/reporte/pdf/render";
import type { AssignmentRow } from "@/lib/reporte/types";

/* ------------------------------- datos ------------------------------- */

const MES_EJEMPLO = "2026-09";
const MESES_GENERADOS = [
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
  "2026-07",
  "2026-08",
  "2026-09",
];

const SUPERVISORES = [
  { email: "ana.gutierrez@icave.mx", nombre: "Ana Gutiérrez" },
  { email: "bruno.martinez@icave.mx", nombre: "Bruno Martínez" },
  { email: "carla.rivera@icave.mx", nombre: "Carla Rivera" },
  { email: "diego.sanchez@icave.mx", nombre: "Diego Sánchez" },
  { email: "elena.ortiz@icave.mx", nombre: "Elena Ortiz" },
  { email: "fabian.torres@icave.mx", nombre: "Fabián Torres" },
  { email: "gabriela.nunez@icave.mx", nombre: "Gabriela Núñez" },
  { email: "hector.dominguez@icave.mx", nombre: "Héctor Domínguez" },
  { email: "irene.vargas@icave.mx", nombre: "Irene Vargas" },
  { email: "jorge.campos@icave.mx", nombre: "Jorge Campos" },
  { email: "karina.mendez@icave.mx", nombre: "Karina Méndez" },
  { email: "luis.palacios@icave.mx", nombre: "Luis Palacios" },
  { email: "monica.serrano@icave.mx", nombre: "Mónica Serrano" },
  { email: "nestor.rojas@icave.mx", nombre: "Néstor Rojas" },
  { email: "olivia.bravo@icave.mx", nombre: "Olivia Bravo" },
  { email: "pablo.escobar@icave.mx", nombre: "Pablo Escobar" },
  { email: "quetzali.ramos@icave.mx", nombre: "Quetzali Ramos" },
  { email: "raul.ibarra@icave.mx", nombre: "Raúl Ibarra" },
];

/** Desempeño esperado por supervisor (probabilidad de completar). */
const DESEMPENO = [
  0.92, 0.9, 0.88, 0.86, 0.83, 0.81, 0.78, 0.76, 0.74, 0.71, 0.68, 0.62, 0.58,
  0.52, 0.46, 0.38, 0.29, 0.21,
];

const ACTIVIDADES = [
  "Inspección de patio norte",
  "Revisión de maniobras de grúa",
  "Control de inventario de contenedores",
  "Auditoría de equipos de protección personal",
  "Verificación de sellos de seguridad",
  "Levantamiento de incidencias operativas",
  "Mantenimiento preventivo de reach stackers",
  "Supervisión de carga refrigerada",
  "Revisión de documentación aduanal",
  "Control de tiempos de atraque",
  "Inspección de rampa ferroviaria",
  "Verificación de señalización de patio",
  "Auditoría de consumibles de taller",
  "Revisión de rutas de evacuación",
  "Inspección de grúas RTG",
  "Control de accesos y gafetes",
  "Revisión de bitácoras de turno",
  "Inspección de extinguidores y red hidráulica",
];

const PRIORIDADES = ["Urgente", "Medio", "No Urgente", "Urgente", "Medio", "No Urgente", "Medio", "Alta"];

const COMENTARIOS = [
  "Evidencia incompleta: falta fotografía del número de serie.",
  "Se solicita repetir la medición con equipo calibrado.",
  "El reporte no incluye firma del responsable de turno.",
  "Formato de checklist incorrecto, favor de usar el vigente.",
  "Falta anexar el plano de ubicación del contenedor.",
];

/* ------------------------------ utilidades ------------------------------ */

/** PRNG determinista (mulberry32) para que el ejemplo sea reproducible. */
function crearRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function diasDelMes(monthKey: string): number {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function iso(monthKey: string, dia: number, hora: number, minuto = 0): string {
  const [y, m] = monthKey.split("-").map(Number);
  const diaSeguro = Math.min(dia, diasDelMes(monthKey));
  return new Date(Date.UTC(y, m - 1, diaSeguro, hora, minuto)).toISOString();
}

function construirFilas(): AssignmentRow[] {
  const rand = crearRandom(20260901);
  const filas: AssignmentRow[] = [];
  let contador = 0;

  for (const mes of MESES_GENERADOS) {
    const ultimoDia = diasDelMes(mes);
    const cantidad = 88 + Math.floor(rand() * 18);

    for (let i = 0; i < cantidad; i += 1) {
      contador += 1;
      const indiceSupervisor = Math.floor(rand() * SUPERVISORES.length);
      const supervisor = SUPERVISORES[indiceSupervisor];
      const desempeno = DESEMPENO[indiceSupervisor];

      const diaCreacion = 1 + Math.floor(rand() * Math.max(1, ultimoDia - 12));
      const created = iso(mes, diaCreacion, 7 + Math.floor(rand() * 10), Math.floor(rand() * 60));
      const diasPlazo = 3 + Math.floor(rand() * 14);
      const due = iso(mes, diaCreacion + diasPlazo, 23, 59);

      const actividad = ACTIVIDADES[Math.floor(rand() * ACTIVIDADES.length)];
      const prioridad = PRIORIDADES[Math.floor(rand() * PRIORIDADES.length)];
      const conEvidencia = rand() < 0.82;

      const r = rand();
      let status: string;
      let submitted: string | null = null;

      if (r < desempeno) {
        const extemporanea = rand() < 0.15;
        status = "Completada";
        submitted = extemporanea
          ? iso(mes, diaCreacion + diasPlazo + 1 + Math.floor(rand() * 6), 10 + Math.floor(rand() * 8))
          : iso(mes, diaCreacion + 1 + Math.floor(rand() * Math.max(1, diasPlazo - 1)), 10 + Math.floor(rand() * 8));
      } else if (r < desempeno + 0.14) {
        status = "Entregada";
        submitted = iso(mes, diaCreacion + diasPlazo, 12 + Math.floor(rand() * 8));
      } else {
        status = rand() < 0.45 ? "En curso" : "Pendiente";
      }

      const conComentario = status === "Completada" && rand() < 0.08;

      filas.push({
        id: `tarea-${contador}`,
        title: actividad,
        description: `${actividad} correspondiente al turno ${1 + Math.floor(rand() * 3)} del patio ${1 + Math.floor(rand() * 4)}.`,
        status,
        priority: prioridad,
        created_at: created,
        due_at: due,
        submitted_at: submitted,
        assigned_to_email: supervisor.email,
        submitted_by_email: submitted ? supervisor.email : null,
        submission_files: submitted && conEvidencia ? [{ name: "evidencia.jpg" }] : [],
        submission_path: null,
        reviewer_comment: conComentario ? COMENTARIOS[Math.floor(rand() * COMENTARIOS.length)] : null,
        reviewer_comment_at: conComentario ? due : null,
      });
    }
  }

  return filas;
}

/* -------------------------------- prueba -------------------------------- */

describe("PDF de ejemplo del reporte mensual", () => {
  it("genera un PDF válido con datos de prueba", async () => {
    const report = buildMonthlyReport({
      monthKey: MES_EJEMPLO,
      parcial: false,
      now: new Date("2026-10-22T12:00:00.000Z"),
      folio: "REP-2026-09-0001",
      generadoEn: new Date("2026-10-22T12:00:00.000Z"),
      generadoPor: { id: "revisor-1", email: "revisor@icave.mx", nombre: "Revisor de Cumplimiento" },
      supervisorFiltro: null,
      rows: construirFilas(),
      actividadesMatriz: [...ACTIVIDADES, "Inspección de bodega fiscalizada", "Revisión de tarifas de almacenaje"],
      supervisorNames: Object.fromEntries(SUPERVISORES.map((s) => [s.email, s.nombre])),
      trendMonths: 6,
    });

    expect(report.meta.sinDatos).toBe(false);
    expect(report.supervisores.length).toBe(SUPERVISORES.length);
    expect(report.tendencia.length).toBe(6);
    expect(report.anexo.length).toBeGreaterThan(50);
    expect(report.resumenEjecutivo.length).toBeGreaterThanOrEqual(4);
    expect(report.hallazgos.length).toBeGreaterThan(0);
    expect(report.recomendaciones.length).toBeGreaterThan(0);

    const buffer = await renderMonthlyReportPdf(report);
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(20_000);

    const destino = path.join(process.cwd(), "reporte-mensual-ejemplo.pdf");
    fs.writeFileSync(destino, buffer);
    expect(fs.statSync(destino).size).toBeGreaterThan(20_000);
  });
});
