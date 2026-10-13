import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente con service role key. IGNORA las políticas RLS.
 * ÚSALO SOLO EN EL SERVIDOR (server components / server actions)
 * y solo para operaciones que necesitan acceso total,
 * como el dashboard del revisor que debe ver TODAS las asignaciones.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Missing Supabase service role environment variables");
  }

  return createSupabaseClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
