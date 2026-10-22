/**
 * Autorización del módulo de Reportes.
 *
 * El reporte mensual es exclusivo del rol Revisor. Se reutiliza el chequeo
 * reforzado de `lib/platform-roles.ts` (que tolera cache de esquema y
 * diferencias de mayúsculas en los UUID).
 */

import { createClient } from "@/utils/supabase/server";
import { strongCheckIsRevisor } from "@/lib/platform-roles";
import { displayNameFromEmail } from "./monthly-report";

/** Contexto del revisor autenticado (coincide con `ReportUserContext`). */
export interface ReportRevisorContext {
  id: string;
  email: string;
  nombre: string;
}

export type RevisorAuthResult =
  | { ok: true; ctx: ReportRevisorContext }
  | { ok: false; status: 401 | 403; message: string };

function nameFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
  email: string
): string {
  if (metadata && typeof metadata === "object") {
    for (const key of ["full_name", "display_name", "name"]) {
      const value = metadata[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return displayNameFromEmail(email);
}

export async function requireRevisor(): Promise<RevisorAuthResult> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return { ok: false, status: 403, message: "Falta configurar Supabase." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  const user = error ? null : data?.user ?? null;

  if (!user?.id) {
    return { ok: false, status: 401, message: "Sesión no válida o expirada." };
  }

  const email = (user.email ?? "").trim().toLowerCase();
  const { isRevisor } = await strongCheckIsRevisor(supabase, user.id, { email });

  if (!isRevisor) {
    return {
      ok: false,
      status: 403,
      message: "El reporte mensual está disponible únicamente para el rol Revisor.",
    };
  }

  return {
    ok: true,
    ctx: {
      id: user.id,
      email,
      nombre: nameFromMetadata(user.user_metadata as Record<string, unknown> | undefined, email),
    },
  };
}
