"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sileo } from "sileo";
import { createClient } from "@/utils/supabase/client";
import { maxSubmissionSizeBytes } from "@/lib/submission-files";
import { Upload, CheckCircle } from "@/components/ui/icons";
import { attachActividadDiariaPdf } from "@/app/platform/actividades-diarias/supervisor/actions";
import { ACTIVIDADES_BUCKET } from "@/app/platform/actividades-diarias/tipos";
import { saveActividadExtraordinaria } from "@/app/platform/actividades-diarias/extraordinarias/actions";

const MAX_SIZE = maxSubmissionSizeBytes();

/**
 * Categorías de actividades extraordinarias y sus subcategorías.
 * Se omiten las subcategorías que solo repetían el nombre de la categoría,
 * quedando la categoría "sin subcategoría" (campo deshabilitado).
 */
export const CATEGORIAS_EXTRAORDINARIAS: {
  nombre: string;
  subcategorias: string[];
  actividades?: string[];
}[] = [
  {
    nombre: "Atención a Incidentes",
    subcategorias: ["INCIDENTE PERSONAL", "INCIDENTE MATERIAL"],
  },
  {
    nombre: "Atención de Emergencias",
    subcategorias: [
      "CONATO DE INCENDIO",
      "ATENCION A DERRAME",
      "SISMO",
      "RESCATE ACUATICO",
      "TRASLADO DE LESIONADO",
      "TRASLADO POR ENFERMEDAD GENERAL",
    ],
  },
  { nombre: "Actos Inseguros Detectados", subcategorias: [] },
  { nombre: "Condición Insegura Detectada", subcategorias: [] },
  { nombre: "Actividades referente al Clima", subcategorias: [] },
  { nombre: "Reporte de Riesgo", subcategorias: [] },
  {
    nombre: "Capacitación",
    subcategorias: ["CAPACITACION", "CAPACITACION A BRIGADAS", "CAPACITACION EN LINEA"],
  },
  { nombre: "Actividades de Mejora", subcategorias: [] },
  {
    nombre: "Actividades Varias",
    subcategorias: [],
    actividades: [
      "Surtir dispensadores shampoo/ gel antibacterial",
      "Checar niveles de los vehículos utilitarios",
      "Carga de combustible en vehículos del departamento",
      "Retiro/Recepción de extintores para recarga",
      "Entrega de Equipo de protección personal para visitas.",
      "Apoyo de guía a visitas en la TEC",
      "Colocación / Retiro de barreras para visita.",
      "Lavado de vehículos del área.",
      "Trabajador Sindicalizado",
    ],
  },
];

type CampoDinamico = {
  nombre: string;
  opciones: string[];
  dependeDe?: { campo: string; valor: string };
};

const AREAS_INCIDENTE = [
  "Muelle",
  "Previos",
  "Almacén CFS",
  "Mantenimiento",
  "Vacios",
  "Patio",
  "Control aduanero",
  "Almacén de Partes",
  "Administrativo",
  "CCI",
  "RRHH",
  "Contratista",
];

const EQUIPOS_INVOLUCRADOS = [
  "Grúa Pórtico",
  "Grúa RTG",
  "Equipo Autónomo (AT)",
  "Equipo A",
  "Equipo B",
  "Tractoplana",
  "Montacarga",
  "SPF",
  "Equipo / Vehículo Contratista",
  "Vehículo Particular",
  "Vehículo Autoridades",
  "Otro",
];

const ACTIVIDAD_POR_CATEGORIA: Record<string, string> = {
  "Actos Inseguros Detectados": "ACTOS INSEGUROS DETECTADOS",
  "Condición Insegura Detectada": "CONDICION INSEGURA DETECTADA",
  "Actividades referente al Clima": "ACTIVIDADES REFERENTE AL CLIMA",
  "Reporte de Riesgo": "REPORTE DE RIESGO",
  "Actividades de Mejora": "ACTIVIDADES DE MEJORA",
};

const CAMPOS_POR_ACTIVIDAD: Record<string, CampoDinamico[]> = {
  "INCIDENTE PERSONAL": [
    {
      nombre: "Lesionado",
      opciones: [
        "Trabajador Permanente",
        "Trabajador Sindicalizado",
        "Controlador Eventual",
        "Trabajador Contratista o proveedor",
        "Empleado Aduanal",
        "Operador de SPF",
        "Autoridad (Aduana, ASIPONA)",
        "Visitante",
        "Otro",
      ],
    },
    {
      nombre: "Tipo de incidente personal",
      opciones: [
        "Trabajador Incapacitante IMSS",
        "Incapacitante SMI",
        "No Incapacitante (Primeros Auxilios)",
      ],
    },
    { nombre: "Área del lesionado", opciones: AREAS_INCIDENTE },
  ],
  "INCIDENTE MATERIAL": [
    { nombre: "Equipo Involucrado", opciones: EQUIPOS_INVOLUCRADOS },
    { nombre: "Área del incidente", opciones: AREAS_INCIDENTE },
  ],
  "CONATO DE INCENDIO": [
    {
      nombre: "Área del conato",
      opciones: [
        "Muelle",
        "Previos",
        "Almacén CFS",
        "Mantenimiento",
        "Vacios",
        "Patio",
        "Control aduanero",
        "Almacén de Partes",
        "Administrativo",
        "CCI",
        "Contratista",
      ],
    },
  ],
  "ATENCION A DERRAME": [
    {
      nombre: "Tipo de derrame",
      opciones: ["Equipo Portuario", "Contenedor (Mercancía)", "Otro"],
    },
    {
      nombre: "Tipo (Contenedor / Mercancía)",
      opciones: [
        "IMO clase 3",
        "IMO clase 4.1",
        "IMO clase 4.2",
        "IMO clase 4.3",
        "IMO clase 5.1",
        "IMO clase 5.2",
        "IMO clase 6.1",
        "IMO clase 8",
      ],
      dependeDe: { campo: "Tipo de derrame", valor: "Contenedor (Mercancía)" },
    },
    {
      nombre: "Tipo (Equipo Portuario)",
      opciones: [
        "Tractoplana",
        "Montacargas",
        "Equipo A",
        "Equipo B",
        "Grua RTG",
        "Grua Portico",
        "Equipo Autonomo (AT)",
      ],
      dependeDe: { campo: "Tipo de derrame", valor: "Equipo Portuario" },
    },
  ],
  "ACTOS INSEGUROS DETECTADOS": [
    {
      nombre: "Tipo",
      opciones: [
        "Trabajador Permanente",
        "Trabajador Sindicalizado",
        "Controlador Eventual",
        "Trabajador Contratista o proveedor",
        "Empleado Aduanal",
        "Operador de SPF",
        "Autoridad (Aduana, ASIPONA)",
        "Visitante",
        "Otro",
      ],
    },
  ],
  "CONDICION INSEGURA DETECTADA": [
    {
      nombre: "Tipo",
      opciones: [
        "Infraestructura",
        "Equipo Portuario",
        "Materiales y equipos contratistas",
        "Buque",
        "Contenedor",
        "Camión de SPF",
        "Otro",
      ],
    },
  ],
  "ACTIVIDADES REFERENTE AL CLIMA": [
    {
      nombre: "Actividades referentes al clima",
      opciones: [
        "Supervision de anclaje de gruas QC",
        "Validar funcionamiento de anemometro",
        "Revision del Check List para Nortes",
        "Envio de Boletin",
        "Monitoreo de la velocidad del viento",
        "Envio de Grafica de viento",
        "Otra",
      ],
    },
  ],
  "REPORTE DE RIESGO": [
    {
      nombre: "Reportes de riesgo",
      opciones: ["Casi incidente", "Situacion Potencial de Riesgo", "Analisis de Riego de Actividad"],
    },
  ],
  CAPACITACION: [
    {
      nombre: "Tipo de capacitación",
      opciones: [
        "Induccion a contratistas",
        "Induccion a SOS",
        "Combate contraincendio",
        "Manejo Defensivo",
        "Curso Mercancías Peligrosas",
        "Vigilancia en Patio",
        "Pruebas Fisica",
        "Reglamento de Seguridad",
        "Prueba de Vertigo",
        "Prueba de Fuerza",
        "Otro",
      ],
    },
  ],
  "CAPACITACION A BRIGADAS": [
    {
      nombre: "Tipo de capacitación a brigadas",
      opciones: [
        "Capacitacion Contraincendios",
        "Capacitacion Rescate Acuatico",
        "Capacitación de Rescate en alturas",
      ],
    },
  ],
  "CAPACITACION EN LINEA": [
    {
      nombre: "Tipo de curso",
      opciones: [
        "Curso en linea HP ICAVE",
        "Curso en linea HK",
        "Otros curso",
        "Diplomado de Seguridad TEC MTY",
        "Diplomado NEBOSH",
        "CURSO NEBOSH",
      ],
    },
  ],
  "ACTIVIDADES DE MEJORA": [
    {
      nombre: "Tipo de actividad de mejora",
      opciones: [
        "Formacion / adiestramiento por su propia cuenta",
        "Mejoras Rapidas",
        "Proyecto de Mejora",
        "Propuestas de mejora",
        "Reconocimiento Externo",
        "Otra actividad de mejora continua",
      ],
    },
  ],
};

export type ExtraordinariasCatalogos = {
  puestos: { id_puesto: number; nombre: string }[];
  turnos: { id_turno: number; nombre: string }[];
  tipos: { id_tipo: number; clave: string; descripcion: string | null }[];
  areas: { id_area: number; nombre: string }[];
};

const inputClass =
  "h-10 w-full rounded-lg border border-[#d9dee7] bg-white px-3 text-sm text-[#141414] outline-none transition-colors placeholder:text-[#9aa1ad] focus:border-[#0f766e] focus:ring-2 focus:ring-[#0f766e]/15";
const labelClass = "text-sm font-medium text-[#2b2926]";

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function ExtraordinariasForm({
  catalogos,
  userId,
}: {
  catalogos: ExtraordinariasCatalogos;
  userId: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [savedId, setSavedId] = useState<string | null>(null);
  const [fecha, setFecha] = useState(todayYmd());
  const [idPuesto, setIdPuesto] = useState("");
  const [idTurno, setIdTurno] = useState("");
  const [idTipo, setIdTipo] = useState("");
  const [idArea, setIdArea] = useState("");
  const [categoria, setCategoria] = useState("");
  const [subcategoria, setSubcategoria] = useState("");
  const [actividad, setActividad] = useState("");
  const [respuestasCampos, setRespuestasCampos] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Subcategorías disponibles según la categoría elegida.
  const subcategorias =
    CATEGORIAS_EXTRAORDINARIAS.find((c) => c.nombre === categoria)?.subcategorias ?? [];
  const actividades =
    CATEGORIAS_EXTRAORDINARIAS.find((c) => c.nombre === categoria)?.actividades ?? [];
  const sinSubcategorias = subcategorias.length === 0;
  const actividadSeleccionada =
    actividad || subcategoria || ACTIVIDAD_POR_CATEGORIA[categoria] || "";
  const camposActividad = CAMPOS_POR_ACTIVIDAD[actividadSeleccionada] ?? [];
  const camposVisibles = camposActividad.filter(
    (campo) =>
      !campo.dependeDe ||
      respuestasCampos[campo.dependeDe.campo] === campo.dependeDe.valor,
  );

  const actualizarCampo = (nombre: string, valor: string) => {
    setRespuestasCampos((actuales) => {
      const siguientes = { ...actuales, [nombre]: valor };
      if (nombre === "Tipo de derrame") {
        delete siguientes["Tipo (Contenedor / Mercancía)"];
        delete siguientes["Tipo (Equipo Portuario)"];
      }
      return siguientes;
    });
  };

  const handleFile = (list: FileList | null) => {
    const picked = list && list[0] ? list[0] : null;
    if (!picked) {
      setFile(null);
      return;
    }
    const isPdf =
      picked.type === "application/pdf" || picked.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      sileo.error({ title: "Archivo inválido", description: "Solo se permiten archivos PDF." });
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (picked.size > MAX_SIZE) {
      sileo.error({
        title: "Archivo demasiado grande",
        description: `El límite es ${Math.round(MAX_SIZE / (1024 * 1024))} MB.`,
      });
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setFile(picked);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    if (!fecha) {
      sileo.error({ title: "Falta la fecha", description: "Selecciona la fecha." });
      return;
    }
    if (!idPuesto) {
      sileo.error({ title: "Falta el puesto", description: "Selecciona un puesto." });
      return;
    }
    if (!idTurno) {
      sileo.error({ title: "Falta el turno", description: "Selecciona un turno." });
      return;
    }
    if (!idTipo) {
      sileo.error({ title: "Falta el tipo", description: "Selecciona un tipo." });
      return;
    }
    if (!categoria) {
      sileo.error({ title: "Falta la categoría", description: "Selecciona una categoría." });
      return;
    }
    if (!subcategoria && !sinSubcategorias) {
      sileo.error({ title: "Falta la subcategoría", description: "Selecciona una subcategoría." });
      return;
    }
    if (actividades.length > 0 && !actividad) {
      sileo.error({ title: "Falta la actividad", description: "Selecciona una actividad." });
      return;
    }
    const campoPendiente = camposVisibles.find((campo) => !respuestasCampos[campo.nombre]);
    if (campoPendiente) {
      sileo.error({
        title: "Falta información",
        description: `Completa el campo "${campoPendiente.nombre}".`,
      });
      return;
    }

    setSubmitting(true);
    let toastId: string | null = null;
    let recordSaved = false;

    try {
      toastId = sileo.show({
        type: "loading",
        title: savedId ? "Actualizando registro" : "Guardando registro",
        description: file?.name,
        duration: null,
      });

      const formData = new FormData();
      if (savedId) formData.set("id", savedId);
      formData.set("fecha", fecha);
      formData.set("id_puesto", idPuesto);
      formData.set("id_turno", idTurno);
      formData.set("id_tipo", idTipo);
      formData.set("id_area", idArea);
      formData.set("categoria", categoria);
      formData.set("subcategoria", subcategoria);
      formData.set("nombre_actividad", actividadSeleccionada);
      formData.set("detalle_actividad", JSON.stringify(respuestasCampos));

      const saved = await saveActividadExtraordinaria(formData);
      sileo.dismiss(toastId);
      toastId = null;
      if (!saved.ok) {
        sileo.error({ title: "No se pudo guardar", description: saved.error });
        return;
      }

      recordSaved = true;
      setSavedId(saved.id);

      if (file) {
        toastId = sileo.show({
          type: "loading",
          title: "Subiendo PDF a actdiarias",
          description: file.name,
          duration: null,
        });
        const objectPath = `${userId}/${saved.id}/documento.pdf`;
        const { error: uploadError } = await createClient()
          .storage.from(ACTIVIDADES_BUCKET)
          .upload(objectPath, file, { contentType: "application/pdf", upsert: true });
        if (uploadError) throw uploadError;

        const attached = await attachActividadDiariaPdf(saved.id, file.name);
        sileo.dismiss(toastId);
        toastId = null;
        if (!attached.ok) {
          sileo.error({
            title: "Registro guardado, PDF pendiente",
            description: attached.error,
          });
          router.refresh();
          return;
        }
      }

      sileo.success({
        title: savedId ? "Registro actualizado" : "Registro guardado",
        description: file
          ? "El registro extraordinario y su PDF se guardaron correctamente."
          : "El registro extraordinario se guardó correctamente.",
      });
      setSavedId(null);
      setFecha(todayYmd());
      setIdPuesto("");
      setIdTurno("");
      setIdTipo("");
      setIdArea("");
      setCategoria("");
      setSubcategoria("");
      setActividad("");
      setRespuestasCampos({});
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch (error) {
      if (toastId) sileo.dismiss(toastId);
      const errorMessage =
        error instanceof Error ? error.message : "Error inesperado al guardar.";
      sileo.error({
        title: recordSaved ? "Registro guardado, PDF pendiente" : "Error",
        description: recordSaved
          ? `El registro quedó guardado, pero el PDF no se adjuntó: ${errorMessage}`
          : errorMessage,
      });
      if (recordSaved) router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-[1.75rem] border border-[#e6e8ec] bg-white p-6 shadow-[0_1px_2px_rgba(20,20,20,0.04)] sm:p-8">
      <h2 className="text-[19px] font-semibold tracking-[-0.02em] text-[#141414]">
        Nuevo registro
      </h2>

      <form className="mt-6 grid gap-5" onSubmit={handleSubmit}>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="grid gap-2">
            <label className={labelClass} htmlFor="puesto">
              Puesto <span className="text-[#d64545]">*</span>
            </label>
            <select
              id="puesto"
              required
              value={idPuesto}
              onChange={(e) => setIdPuesto(e.target.value)}
              className={inputClass}
            >
              <option value="">Selecciona un puesto…</option>
              {catalogos.puestos.map((p) => (
                <option key={p.id_puesto} value={p.id_puesto}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <label className={labelClass} htmlFor="turno">
              Turno <span className="text-[#d64545]">*</span>
            </label>
            <select
              id="turno"
              required
              value={idTurno}
              onChange={(e) => setIdTurno(e.target.value)}
              className={inputClass}
            >
              <option value="">Selecciona un turno…</option>
              {catalogos.turnos.map((t) => (
                <option key={t.id_turno} value={t.id_turno}>
                  {t.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <label className={labelClass} htmlFor="tipo">
              Tipo <span className="text-[#d64545]">*</span>
            </label>
            <select
              id="tipo"
              required
              value={idTipo}
              onChange={(e) => setIdTipo(e.target.value)}
              className={inputClass}
            >
              <option value="">Selecciona un tipo…</option>
              {catalogos.tipos.map((t) => (
                <option key={t.id_tipo} value={t.id_tipo}>
                  {t.descripcion?.trim() || t.clave}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <label className={labelClass} htmlFor="area">
              Área
            </label>
            <select
              id="area"
              value={idArea}
              onChange={(e) => setIdArea(e.target.value)}
              className={inputClass}
            >
              <option value="">Selecciona un área…</option>
              {catalogos.areas.map((area) => (
                <option key={area.id_area} value={area.id_area}>
                  {area.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <label className={labelClass} htmlFor="categoria">
              Categoría <span className="text-[#d64545]">*</span>
            </label>
            <select
              id="categoria"
              required
              value={categoria}
              onChange={(e) => {
                setCategoria(e.target.value);
                setSubcategoria("");
                setActividad("");
                setRespuestasCampos({});
              }}
              className={inputClass}
            >
              <option value="">Selecciona una categoría…</option>
              {CATEGORIAS_EXTRAORDINARIAS.map((c) => (
                <option key={c.nombre} value={c.nombre}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <label className={labelClass} htmlFor="subcategoria">
              Subcategoría{" "}
              {!sinSubcategorias && <span className="text-[#d64545]">*</span>}
            </label>
            <select
              id="subcategoria"
              required={!sinSubcategorias}
              disabled={!categoria || sinSubcategorias}
              value={subcategoria}
              onChange={(e) => {
                setSubcategoria(e.target.value);
                setRespuestasCampos({});
              }}
              className={`${inputClass} disabled:cursor-not-allowed disabled:bg-[#f4f5f7] disabled:text-[#9aa1ad]`}
            >
              <option value="">
                {!categoria
                  ? "Selecciona primero una categoría…"
                  : sinSubcategorias
                    ? "Esta categoría no tiene subcategorías"
                    : "Selecciona una subcategoría…"}
              </option>
              {subcategorias.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <label className={labelClass} htmlFor="fecha">
              Fecha <span className="text-[#d64545]">*</span>
            </label>
            <input
              id="fecha"
              type="date"
              required
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        {categoria && (
          <section className="rounded-2xl border border-[#dce9e7] bg-[#f7fbfa] p-5 sm:p-6">
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#0f766e]">
                Detalle de la actividad
              </p>
              <h3 className="mt-1 text-base font-semibold text-[#141414]">
                Información adicional
              </h3>
            </div>
            {(actividades.length > 0 || camposVisibles.length > 0) && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {actividades.length > 0 && (
                  <div className="grid gap-2">
                    <label className={labelClass} htmlFor="actividad">
                      Actividad <span className="text-[#d64545]">*</span>
                    </label>
                    <select
                      id="actividad"
                      required
                      value={actividad}
                      onChange={(e) => {
                        setActividad(e.target.value);
                        setRespuestasCampos({});
                      }}
                      className={inputClass}
                    >
                      <option value="">Selecciona una actividad…</option>
                      {actividades.map((opcion) => (
                        <option key={opcion} value={opcion}>
                          {opcion}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {camposVisibles.map((campo, index) => (
                  <div className="grid gap-2" key={campo.nombre}>
                    <label className={labelClass} htmlFor={`detalle-${index}`}>
                      {campo.nombre} <span className="text-[#d64545]">*</span>
                    </label>
                    <select
                      id={`detalle-${index}`}
                      required
                      value={respuestasCampos[campo.nombre] ?? ""}
                      onChange={(e) => actualizarCampo(campo.nombre, e.target.value)}
                      className={inputClass}
                    >
                      <option value="">Selecciona una opción…</option>
                      {campo.opciones.map((opcion) => (
                        <option key={opcion} value={opcion}>
                          {opcion}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
            {actividades.length === 0 && camposVisibles.length === 0 && actividadSeleccionada ? (
              <p className="text-sm leading-6 text-[#68716f]">
                No hay campos adicionales para esta selección.
              </p>
            ) : actividades.length === 0 && camposVisibles.length === 0 ? (
              <p className="text-sm leading-6 text-[#68716f]">
                Selecciona una subcategoría para mostrar sus campos.
              </p>
            ) : null}
          </section>
        )}

        {/* Adjunto PDF al final */}
        <div className="grid gap-2">
          <label className={labelClass}>Adjunto (PDF)</label>
          <label className="group flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-[#d9dee7] bg-[#fafbfc] px-4 py-4 transition-colors hover:border-[#0f766e]/50 hover:bg-[#f4f5f7]">
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => handleFile(e.target.files)}
            />
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0f766e]/10 text-[#0f766e]">
              <Upload size={18} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-[#2b2926]">
                {file ? file.name : "Selecciona un archivo PDF"}
              </span>
              <span className="block text-xs text-[#8b93a1]">
                {file
                  ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
                  : `Opcional · máx. ${Math.round(MAX_SIZE / (1024 * 1024))} MB`}
              </span>
            </span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0f766e] px-5 text-sm font-medium text-white transition-colors hover:bg-[#0b5c56] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <CheckCircle size={16} />
            {submitting ? "Guardando…" : "Guardar registro"}
          </button>
        </div>
      </form>
    </section>
  );
}
