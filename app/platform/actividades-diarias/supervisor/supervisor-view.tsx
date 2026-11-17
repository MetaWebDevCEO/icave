"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sileo } from "sileo";
import { createClient } from "@/utils/supabase/client";
import { formatCalendarDateShort } from "@/lib/calendar-date";
import { maxSubmissionSizeBytes } from "@/lib/submission-files";
import {
  attachActividadDiariaPdf,
  saveActividadDiaria,
} from "@/app/platform/actividades-diarias/supervisor/actions";
import {
  ACTIVIDADES_BUCKET,
  detalleActividadLabel,
  tipoLabel,
  type ActividadDiariaRow,
  type ActividadesCatalogos,
} from "@/app/platform/actividades-diarias/tipos";
import {
  FileText,
  Upload,
  Pencil,
  CheckCircle,
  X,
} from "@/components/ui/icons";

const MAX_SIZE = maxSubmissionSizeBytes();
const ACTIVIDAD_ORDER = [
  "A",
  "B",
  "C",
  "Patrullero",
  "Monitorista",
  "Aperturas",
  "Autorización IMOS",
];
const inputClass =
  "h-10 w-full rounded-lg border border-[#d9dee7] bg-white px-3 text-sm text-[#141414] outline-none transition-colors placeholder:text-[#9aa1ad] focus:border-[#0f766e] focus:ring-2 focus:ring-[#0f766e]/15";
const labelClass = "text-sm font-medium text-[#2b2926]";

function normalizeActividadName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es");
}

const actividadOrder = new Map(
  ACTIVIDAD_ORDER.map((name, index) => [normalizeActividadName(name), index]),
);

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function SupervisorView({
  userId,
  rows,
  catalogos,
}: {
  userId: string;
  rows: ActividadDiariaRow[];
  catalogos: ActividadesCatalogos;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [fecha, setFecha] = useState(todayYmd());
  const [idPuesto, setIdPuesto] = useState("");
  const [idTurno, setIdTurno] = useState("");
  const [idTipo, setIdTipo] = useState("");
  const [idArea, setIdArea] = useState("");
  const [idTipoActividad, setIdTipoActividad] = useState("");
  const [idActividad, setIdActividad] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Actividades válidas para el tipo, área seleccionada y clasificación.
  const actividadesDisponibles = useMemo(() => {
    if (!idTipo || !idTipoActividad) return [];
    const ids = new Set(
      catalogos.asignaciones
        .filter(
          (a) =>
            String(a.id_tipo) === idTipo &&
            (!idArea || String(a.id_area) === idArea),
        )
        .map((a) => a.id_actividad),
    );
    return catalogos.actividades
      .filter((a) => ids.has(a.id_actividad) && String(a.id_tipo_actividad) === idTipoActividad)
      .sort((a, b) => {
        const nameA = normalizeActividadName(a.nombre);
        const nameB = normalizeActividadName(b.nombre);
        const rankA = actividadOrder.get(nameA) ?? Number.MAX_SAFE_INTEGER;
        const rankB = actividadOrder.get(nameB) ?? Number.MAX_SAFE_INTEGER;

        return rankA === rankB
          ? a.nombre.localeCompare(b.nombre, "es")
          : rankA - rankB;
      });
  }, [catalogos, idTipo, idArea, idTipoActividad]);

  const areasDisponibles = useMemo<Array<{ id_area: number | null; nombre: string }>>(() => {
    if (!idTipo) return [];
    const areasById = new Map(catalogos.areas.map((area) => [area.id_area, area]));

    return catalogos.tiposArea
      .filter((tipoArea) => String(tipoArea.id_tipo) === idTipo)
      .sort((a, b) => a.orden - b.orden)
      .flatMap((tipoArea) => {
        const area = areasById.get(tipoArea.id_area);
        return area ? [{ id_area: area.id_area, nombre: area.nombre }] : [];
      });
  }, [catalogos, idTipo]);

  const areaRequerida =
    idTipo !== "" && catalogos.tiposArea.some((tipoArea) => String(tipoArea.id_tipo) === idTipo);

  const resetForm = () => {
    setEditingId(null);
    setFecha(todayYmd());
    setIdPuesto("");
    setIdTurno("");
    setIdTipo("");
    setIdArea("");
    setIdTipoActividad("");
    setIdActividad("");
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const startEdit = (row: ActividadDiariaRow) => {
    setEditingId(row.id);
    setFecha(row.fecha ?? "");
    setIdPuesto(row.id_puesto != null ? String(row.id_puesto) : "");
    setIdTurno(row.id_turno != null ? String(row.id_turno) : "");
    setIdTipo(row.id_tipo != null ? String(row.id_tipo) : "");
    setIdArea(row.id_area != null ? String(row.id_area) : "");
    setIdTipoActividad(row.id_tipo_actividad != null ? String(row.id_tipo_actividad) : "");
    setIdActividad(row.id_actividad != null ? String(row.id_actividad) : "");
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
    document.getElementById("form-actividad")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    if (!idTipoActividad) {
      sileo.error({
        title: "Falta el tipo de actividad",
        description: "Selecciona una categoría de actividad.",
      });
      return;
    }
    if (!idActividad) {
      sileo.error({ title: "Falta la actividad", description: "Selecciona una actividad." });
      return;
    }

    setSubmitting(true);
    let toastId: string | null = null;
    let savedId: string | null = editingId;
    let recordSaved = false;
    const wasEditing = Boolean(editingId);

    try {
      toastId = sileo.show({
        type: "loading",
        title: "Guardando registro",
        description: file?.name,
        duration: null,
      });

      const fd = new FormData();
      if (editingId) fd.set("id", editingId);
      fd.set("fecha", fecha);
      fd.set("id_puesto", idPuesto);
      fd.set("id_turno", idTurno);
      fd.set("id_tipo", idTipo);
      fd.set("id_area", idArea);
      fd.set("id_tipo_actividad", idTipoActividad);
      fd.set("id_actividad", idActividad);

      const res = await saveActividadDiaria(fd);

      if (toastId) {
        sileo.dismiss(toastId);
        toastId = null;
      }

      if (!res.ok) {
        sileo.error({ title: "No se pudo guardar", description: res.error });
        setSubmitting(false);
        return;
      }

      savedId = res.id;
      recordSaved = true;
      setEditingId(savedId);

      if (file) {
        toastId = sileo.show({
          type: "loading",
          title: "Subiendo PDF a actdiarias",
          description: file.name,
          duration: null,
        });

        const objectPath = `${userId}/${savedId}/documento.pdf`;
        const { error: uploadError } = await createClient()
          .storage.from(ACTIVIDADES_BUCKET)
          .upload(objectPath, file, { contentType: "application/pdf", upsert: true });
        if (uploadError) throw uploadError;

        const attached = await attachActividadDiariaPdf(savedId, file.name);
        if (toastId) {
          sileo.dismiss(toastId);
          toastId = null;
        }
        if (!attached.ok) {
          sileo.error({
            title: "Registro guardado, PDF pendiente",
            description: attached.error,
          });
          return;
        }
      }

      sileo.success({
        title: wasEditing ? "Registro actualizado" : "Registro guardado",
        description: file
          ? "El registro y su PDF se guardaron correctamente."
          : "El registro se guardó correctamente.",
      });
      resetForm();
      router.refresh();
    } catch (err) {
      if (toastId) sileo.dismiss(toastId);
      sileo.error({
        title: recordSaved ? "Registro guardado, PDF pendiente" : "Error",
        description: recordSaved
          ? "El registro quedó guardado, pero no se pudo completar la carga del PDF. Intenta guardar los cambios para reintentar."
          : err instanceof Error
            ? err.message
            : "Error inesperado al guardar.",
      });
      if (recordSaved && savedId) setEditingId(savedId);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* ---------------- Clasificación de actividades ---------------- */}
      <div className="flex flex-wrap gap-3">
        <Link
          href="/platform/actividades-diarias/ordinarias"
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0f766e] px-5 text-sm font-medium text-white transition-colors hover:bg-[#0b5c56]"
        >
          Actividades Ordinarias
        </Link>
        <Link
          href="/platform/actividades-diarias/extraordinarias"
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#d9dee7] bg-white px-5 text-sm font-medium text-[#2b2926] transition-colors hover:bg-[#f4f5f7]"
        >
          Actividades Extraordinarias
        </Link>
      </div>

      {/* ---------------- Formulario ---------------- */}
      <section
        id="form-actividad"
        className="rounded-[1.75rem] border border-[#e6e8ec] bg-white p-6 shadow-[0_1px_2px_rgba(20,20,20,0.04)] sm:p-8"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[19px] font-semibold tracking-[-0.02em] text-[#141414]">
            {editingId ? "Editar registro" : "Nuevo registro"}
          </h2>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#d9dee7] bg-white px-3 text-xs font-medium text-[#5f6775] transition-colors hover:bg-[#f4f5f7]"
            >
              <X size={14} />
              Cancelar edición
            </button>
          )}
        </div>

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
                onChange={(e) => {
                  setIdTipo(e.target.value);
                  setIdArea("");
                  setIdActividad("");
                }}
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
                Área{areaRequerida && <span className="text-[#d64545]"> *</span>}
              </label>
              <select
                id="area"
                required={areaRequerida}
                disabled={!idTipo}
                value={idArea}
                onChange={(e) => {
                  setIdArea(e.target.value);
                  setIdActividad("");
                }}
                className={`${inputClass} disabled:cursor-not-allowed disabled:bg-[#f4f5f7] disabled:text-[#9aa1ad]`}
              >
                <option value="">
                  {!idTipo
                    ? "Selecciona primero un tipo…"
                    : areasDisponibles.length === 0
                      ? "No hay áreas configuradas para este tipo"
                      : "Selecciona un área…"}
                </option>
                {areasDisponibles.map((area) => (
                  <option key={area.id_area ?? "null"} value={area.id_area ?? ""}>
                    {area.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <label className={labelClass} htmlFor="tipo-actividad">
                Tipo de actividad <span className="text-[#d64545]">*</span>
              </label>
              <select
                id="tipo-actividad"
                required
                value={idTipoActividad}
                onChange={(e) => {
                  setIdTipoActividad(e.target.value);
                  setIdActividad("");
                }}
                className={inputClass}
              >
                <option value="">Selecciona un tipo de actividad…</option>
                {catalogos.tiposActividad.map((t) => (
                  <option key={t.id_tipo_actividad} value={t.id_tipo_actividad}>
                    {t.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <label className={labelClass} htmlFor="actividad">
                Actividad <span className="text-[#d64545]">*</span>
              </label>
              <select
                id="actividad"
                required
                disabled={!idTipo || !idTipoActividad}
                value={idActividad}
                onChange={(e) => setIdActividad(e.target.value)}
                className={`${inputClass} disabled:cursor-not-allowed disabled:bg-[#f4f5f7] disabled:text-[#9aa1ad]`}
              >
                <option value="">
                  {!idTipo || !idTipoActividad
                    ? "Selecciona tipo y tipo de actividad…"
                    : actividadesDisponibles.length === 0
                      ? "No hay actividades para esta combinación"
                      : "Selecciona una actividad…"}
                </option>
                {actividadesDisponibles.map((a) => (
                  <option key={a.id_actividad} value={a.id_actividad}>
                    {a.nombre}
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
              {submitting ? "Guardando…" : editingId ? "Guardar cambios" : "Guardar registro"}
            </button>
          </div>
        </form>
      </section>

      {/* ---------------- Mis envíos ---------------- */}
      <section className="rounded-[1.75rem] border border-[#e6e8ec] bg-white p-6 shadow-[0_1px_2px_rgba(20,20,20,0.04)] sm:p-8">
        <h2 className="text-[19px] font-semibold tracking-[-0.02em] text-[#141414]">
          Mis envíos
        </h2>
        <p className="mt-1 text-sm text-[#8b93a1]">
          {rows.length === 0
            ? "Aún no has registrado actividades."
            : `${rows.length} registro${rows.length === 1 ? "" : "s"}.`}
        </p>

        {rows.length > 0 && (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[1500px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#eceef2] text-xs uppercase tracking-[0.06em] text-[#8b93a1]">
                  <th className="py-2.5 pr-4 font-medium">Fecha</th>
                  <th className="py-2.5 pr-4 font-medium">Puesto</th>
                  <th className="py-2.5 pr-4 font-medium">Turno</th>
                  <th className="py-2.5 pr-4 font-medium">Tipo</th>
                  <th className="py-2.5 pr-4 font-medium">Tipo act.</th>
                  <th className="py-2.5 pr-4 font-medium">Área</th>
                  <th className="py-2.5 pr-4 font-medium">Categoría</th>
                  <th className="py-2.5 pr-4 font-medium">Subcategoría</th>
                  <th className="py-2.5 pr-4 font-medium">Actividad</th>
                  <th className="py-2.5 pr-4 font-medium">Detalle</th>
                  <th className="py-2.5 pr-4 font-medium">Adjunto</th>
                  <th className="py-2.5 pr-4 font-medium">Actualizado</th>
                  <th className="py-2.5 font-medium">Acción</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const pdfName =
                    row.file_name?.trim() || row.file_path?.split("/").pop() || "actividad.pdf";

                  return (
                    <tr key={row.id} className="border-b border-[#f2f3f6] last:border-0">
                      <td className="py-3 pr-4 whitespace-nowrap text-[#2b2926]">
                        {formatCalendarDateShort(row.fecha)}
                      </td>
                      <td className="py-3 pr-4 text-[#2b2926]">{row.puesto?.nombre || "—"}</td>
                      <td className="py-3 pr-4 whitespace-nowrap text-[#5f6775]">
                        {row.turno?.nombre || "—"}
                      </td>
                      <td className="py-3 pr-4 whitespace-nowrap text-[#5f6775]">
                        {tipoLabel(row.tipo) || "—"}
                      </td>
                      <td className="py-3 pr-4 whitespace-nowrap text-[#5f6775]">
                        {row.tipo_actividad?.nombre || "—"}
                      </td>
                      <td className="py-3 pr-4 whitespace-nowrap text-[#5f6775]">
                        {row.area?.nombre || "—"}
                      </td>
                      <td className="py-3 pr-4 text-[#5f6775]">
                        {row.categoria_actividad || "—"}
                      </td>
                      <td className="py-3 pr-4 text-[#5f6775]">
                        {row.subcategoria_actividad || "—"}
                      </td>
                      <td className="py-3 pr-4 text-[#2b2926]">
                        {row.nombre_actividad || row.actividad?.nombre || "—"}
                      </td>
                      <td className="py-3 pr-4 text-[#5f6775]">
                        {detalleActividadLabel(row.detalle_actividad)}
                      </td>
                      <td className="py-3 pr-4">
                        {row.file_path ? (
                          <div className="space-y-1">
                            <span
                              className="block max-w-[220px] truncate text-xs font-medium text-[#5f6775]"
                              title={pdfName}
                            >
                              {pdfName}
                            </span>
                            <a
                              href={`/platform/actividades-diarias/download/${encodeURIComponent(
                                pdfName,
                              )}?id=${row.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 text-[#0f766e] hover:underline"
                            >
                              <FileText size={15} />
                              Ver PDF
                            </a>
                          </div>
                        ) : (
                          <span className="text-[#b4bac4]">Sin adjunto</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 whitespace-nowrap text-[#8b93a1]">
                        {formatCalendarDateShort(row.updated_at)}
                      </td>
                      <td className="py-3">
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#d9dee7] bg-white px-3 text-xs font-medium text-[#2b2926] transition-colors hover:bg-[#f4f5f7]"
                        >
                          <Pencil size={13} />
                          Editar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
