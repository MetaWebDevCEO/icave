export type PuestoOption = { id_puesto: number; nombre: string };
export type TurnoOption = { id_turno: number; nombre: string };
export type TipoOption = { id_tipo: number; clave: string; descripcion: string | null };
export type AreaOption = { id_area: number; nombre: string };
export type TipoActividadOption = { id_tipo_actividad: number; nombre: string };
export type ActividadOption = {
  id_actividad: number;
  nombre: string;
  id_tipo_actividad: number | null;
};

/** Fila de actividad_asignacion: qué actividad aplica a un tipo/área. */
export type ActividadAsignacion = {
  id_actividad: number;
  id_tipo: number;
  id_area: number | null;
};

export type TipoAreaOption = {
  id_tipo: number;
  id_area: number;
  orden: number;
};

export type ActividadesCatalogos = {
  puestos: PuestoOption[];
  turnos: TurnoOption[];
  tipos: TipoOption[];
  areas: AreaOption[];
  tiposActividad: TipoActividadOption[];
  actividades: ActividadOption[];
  asignaciones: ActividadAsignacion[];
  tiposArea: TipoAreaOption[];
};

export type ActividadDiariaRow = {
  id: string;
  user_id: string;
  user_email: string | null;
  fecha: string | null;
  id_puesto: number | null;
  id_turno: number | null;
  id_tipo: number | null;
  id_area: number | null;
  id_tipo_actividad: number | null;
  id_actividad: number | null;
  categoria_actividad?: string | null;
  subcategoria_actividad?: string | null;
  nombre_actividad?: string | null;
  detalle_actividad?: Record<string, string> | null;
  puesto: { nombre: string } | null;
  turno: { nombre: string } | null;
  tipo: { clave: string; descripcion: string | null } | null;
  area: { nombre: string } | null;
  tipo_actividad: { nombre: string } | null;
  actividad: { nombre: string } | null;
  file_path: string | null;
  file_bucket: string | null;
  file_name: string | null;
  file_mime: string | null;
  created_at: string | null;
  updated_at: string | null;
};

/** Nombre visible de un tipo del catálogo (preferimos la descripción). */
export function tipoLabel(tipo: ActividadDiariaRow["tipo"]): string | null {
  if (!tipo) return null;
  return tipo.descripcion?.trim() || tipo.clave;
}

export function detalleActividadLabel(detalle: ActividadDiariaRow["detalle_actividad"]): string {
  if (!detalle) return "—";
  return (
    Object.entries(detalle)
      .filter(([, value]) => typeof value === "string" && value.trim())
      .map(([key, value]) => `${key}: ${value}`)
      .join(" · ") || "—"
  );
}

/** Bucket privado para los PDF de actividades diarias. */
export const ACTIVIDADES_BUCKET = "actdiarias";
