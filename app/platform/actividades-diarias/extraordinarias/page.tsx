import Link from "next/link";
import { redirect } from "next/navigation";
import {
  createClient as createSupabaseAdminClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import {
  ExtraordinariasForm,
  type ExtraordinariasCatalogos,
} from "@/app/platform/actividades-diarias/extraordinarias/extraordinarias-form";

export const dynamic = "force-dynamic";

async function fetchCatalogos(client: SupabaseClient): Promise<ExtraordinariasCatalogos> {
  const [puestos, turnos, tipos, areas] = await Promise.all([
    client.from("puesto").select("id_puesto, nombre").eq("activo", true).order("nombre"),
    client.from("turno").select("id_turno, nombre").eq("activo", true).order("nombre"),
    client.from("tipo").select("id_tipo, clave, descripcion").eq("activo", true).order("clave"),
    client.from("area").select("id_area, nombre").eq("activo", true).order("nombre"),
  ]);

  return {
    puestos: puestos.data ?? [],
    turnos: turnos.data ?? [],
    tipos: tipos.data ?? [],
    areas: areas.data ?? [],
  } as ExtraordinariasCatalogos;
}

export default async function ActividadesExtraordinariasPage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
    redirect("/?error=" + encodeURIComponent("Configura Supabase primero (env vars)."));
  }

  const supabase = (await createClient()) as unknown as SupabaseClient;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const admin =
    serviceKey && !serviceKey.includes("__REPLACE_ME__")
      ? createSupabaseAdminClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;

  const catalogos = await fetchCatalogos(admin ?? supabase);

  return (
    <div className="min-h-screen bg-[#f4f5f7] font-sans text-[#141414]">
      <main className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link
              href="/platform/actividades-diarias"
              className="text-sm font-medium text-[#0f766e] hover:underline"
            >
              ← Volver a Actividades diarias
            </Link>
            <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.03em] text-[#141414]">
              Actividades Extraordinarias
            </h1>
            <p className="mt-1 text-[15px] text-[#5f6775]">
              Registra las actividades extraordinarias del día y adjunta un PDF si lo necesitas.
            </p>
          </div>
        </div>

        <ExtraordinariasForm catalogos={catalogos} userId={user.id} />
      </main>
    </div>
  );
}
