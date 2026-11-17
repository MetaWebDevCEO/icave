/**
 * Módulos del muro (pre-acceso a la plataforma).
 *
 * Los módulos se agregan aquí ÚNICAMENTE cuando su sección ya está programada.
 * No se crean ni se editan desde la interfaz.
 *
 * Para dar de alta un módulo nuevo, agrega un objeto a MURO_MODULOS.
 * `bannerImage` es opcional: si no se indica, se usa un degradado con `accent`.
 */
import type { UserRole } from "@/lib/platform-roles";

/** Ruta distinta según el rol del usuario. */
export type RoleHref = Record<UserRole, string>;

export type MuroModulo = {
  id: string;
  nombre: string;
  subtitulo: string;
  /** Ruta única, o una ruta por rol cuando el destino depende del rol. */
  href: string | RoleHref;
  /** Color base del degradado de portada (hex). */
  accent: string;
  /** Imagen de portada en /public (opcional). */
  bannerImage?: string;
  estado?: "disponible" | "proximamente";
};

export const MURO_MODULOS: MuroModulo[] = [
  {
    id: "gestion-actividades",
    nombre: "Gestión de actividades",
    subtitulo: "Administra y da seguimiento a las actividades.",
    href: { revisor: "/platform/revisor", usuario: "/platform/supervisor" },
    accent: "#032f6c",
    estado: "disponible",
  },
  {
    id: "actividades-diarias",
    nombre: "Actividades diarias",
    subtitulo: "Consulta y entrega tus actividades del día.",
    href: "/platform/actividades-diarias",
    accent: "#0f766e",
    estado: "disponible",
  },
];
