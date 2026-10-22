import { redirect } from "next/navigation";

/**
 * La antigua pestaña "Correos" se reemplazó por el "Reporte Mensual".
 * Se conserva la ruta para no romper enlaces guardados.
 */
export default function CorreosRedirectPage() {
  redirect("/platform/reporte");
}
