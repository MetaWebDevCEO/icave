import Link from "next/link";
import { redirect } from "next/navigation";
import {
  createClient as createSupabaseAdminClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { resolveRoleForUser, type UserRole } from "@/lib/platform-roles";
import type {
  ActividadDiariaRow,
  ActividadesCatalogos,
} from "@/app/platform/actividades-diarias/tipos";
import { SupervisorView } from "@/app/platform/actividades-diarias/supervisor/supervisor-view";
import { RevisorTabla } from "@/app/platform/actividades-diarias/revisor/revisor-tabla";

export const dynamic = "force-dynamic";

const ROW_SELECT =
  "*, puesto(nombre), turno(nombre), tipo(clave, descripcion), area(nombre), tipo_actividad(nombre), actividad(nombre)";

async function fetchActividades(
  supabase: SupabaseClient,
  admin: SupabaseClient | null,
  role: UserRole,
  userId: string
): Promise<ActividadDiariaRow[]> {
  const build = (client: SupabaseClient) => {
    const base = client.from("actividades_diarias").select(ROW_SELECT);
    const filtered = role === "revisor" ? base : base.eq("user_id", userId);
    return filtered
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false });
  };

  // Una respuesta vacía por RLS no es un error; para revisores usamos el
  // cliente de servidor después de resolver el rol para poder leer todos.
  let res =
    role === "revisor" && admin
      ? await build(admin)
      : await build(supabase);
  if ((res.error || !res.data || (role === "revisor" && res.data.length === 0)) && admin) {
    res = await build(admin);
  }
  if (res.error) {
    console.error("[actividades-diarias] No se pudieron cargar los registros:", res.error.message);
  }
  return (res.data ?? []) as unknown as ActividadDiariaRow[];
}

async function fetchCatalogos(client: SupabaseClient): Promise<ActividadesCatalogos> {
  const [puestos, turnos, tipos, areas, tiposActividad, actividades, asignaciones, tiposArea] =
    await Promise.all([
      client.from("puesto").select("id_puesto, nombre").eq("activo", true).order("nombre"),
      client.from("turno").select("id_turno, nombre").eq("activo", true).order("nombre"),
      client.from("tipo").select("id_tipo, clave, descripcion").eq("activo", true).order("clave"),
      client.from("area").select("id_area, nombre").eq("activo", true).order("nombre"),
      client.from("tipo_actividad").select("id_tipo_actividad, nombre").order("nombre"),
      client
        .from("actividad")
        .select("id_actividad, nombre, id_tipo_actividad")
        .eq("activo", true)
        .order("nombre"),
      client.from("actividad_asignacion").select("id_actividad, id_tipo, id_area"),
      client
        .from("tipo_area")
        .select("id_tipo, id_area, orden")
        .eq("activo", true)
        .order("orden"),
    ]);

  return {
    puestos: puestos.data ?? [],
    turnos: turnos.data ?? [],
    tipos: tipos.data ?? [],
    areas: areas.data ?? [],
    tiposActividad: tiposActividad.data ?? [],
    actividades: actividades.data ?? [],
    asignaciones: asignaciones.data ?? [],
    tiposArea: tiposArea.data ?? [],
  } as ActividadesCatalogos;
}

export default async function ActividadesDiariasPage() {
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

  const role = await resolveRoleForUser(supabase, user.id, { email: user.email ?? null });

  const admin =
    serviceKey && !serviceKey.includes("__REPLACE_ME__")
      ? createSupabaseAdminClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;

  const rows = await fetchActividades(supabase, admin, role, user.id);
  const catalogos =
    role === "revisor" ? null : await fetchCatalogos(admin ?? supabase);

  return (
    <div className="min-h-screen bg-[#f4f5f7] font-sans text-[#141414]">
      <main className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link
              href="/platform"
              className="text-sm font-medium text-[#0f766e] hover:underline"
            >
              ← Volver al muro
            </Link>
            <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.03em] text-[#141414]">
              Actividades diarias
            </h1>
            <p className="mt-1 text-[15px] text-[#5f6775]">
              {role === "revisor"
                ? "Revisa y descarga las actividades enviadas por los supervisores."
                : "Registra tus actividades del día y adjunta un PDF si lo necesitas."}
            </p>
          </div>
        </div>

        {role === "revisor" || !catalogos ? (
          <RevisorTabla rows={rows} />
        ) : (
          <SupervisorView userId={user.id} rows={rows} catalogos={catalogos} />
        )}
      </main>
    </div>
  );
}
