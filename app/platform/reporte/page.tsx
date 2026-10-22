import { PlatformShell } from "@/app/platform/platform-shell";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { buildSections, strongCheckIsRevisor, type UserRole } from "@/lib/platform-roles";
import {
  addMonths,
  currentMonthKeyUtc,
  monthLabelEs,
  monthLabelLowerEs,
} from "@/lib/reporte/period";
import {
  fetchSupervisorCatalog,
  getReportAdminClient,
  listHistorial,
  previewMonthlyReport,
} from "@/lib/reporte/service";
import type { MonthlyReport, ReportHistoryEntry } from "@/lib/reporte/types";
import type { ReportSupervisorInfo } from "@/lib/reporte/monthly-report";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Meses cerrados disponibles para el reporte oficial (24 más recientes). */
const CLOSED_MONTHS_BACK = 24;

function firstParam(
  sp: Record<string, string | string[] | undefined>,
  key: string
): string {
  const value = sp[key];
  return typeof value === "string" ? value.trim() : "";
}

function closedMonthOptions(): { value: string; label: string }[] {
  const current = currentMonthKeyUtc();
  const options: { value: string; label: string }[] = [];
  for (let i = 1; i <= CLOSED_MONTHS_BACK; i++) {
    const key = addMonths(current, -i);
    options.push({ value: key, label: monthLabelEs(key) });
  }
  return options;
}

function formatPct(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(1)}%`;
}

function formatDelta(value: number | null, unit: string): string {
  if (value === null || value === undefined) return "—";
  const sign = value > 0 ? "+" : "";
  if (unit === "percent") return `${sign}${value.toFixed(1)} pts`;
  if (unit === "days") return `${sign}${value.toFixed(1)} d`;
  return `${sign}${new Intl.NumberFormat("es-MX").format(value)}`;
}

function KpiCell({
  label,
  value,
  comparison,
}: {
  label: string;
  value: string;
  comparison?: { delta: number | null; unit: string; favorable: boolean | null };
}) {
  const favorable = comparison?.favorable;
  const deltaColor =
    comparison && comparison.delta !== null && comparison.delta !== 0 && favorable !== null
      ? favorable
        ? "text-emerald-700"
        : "text-rose-700"
      : "text-zinc-500";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-[#032F6C]">{value}</p>
      {comparison && comparison.delta !== null ? (
        <p className={`mt-1 text-xs ${deltaColor}`}>
          {formatDelta(comparison.delta, comparison.unit)} vs mes anterior
        </p>
      ) : null}
    </div>
  );
}

export default async function ReportePage({ searchParams }: { searchParams: SearchParams }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  if (!url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
    return redirect("/?error=" + encodeURIComponent("Configura Supabase primero (env vars)."));
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData?.user ?? null;
  if (!user) return redirect("/");

  let role: UserRole = "usuario";
  try {
    const strong = await strongCheckIsRevisor(supabase, user.id, { email: user.email ?? null });
    role = strong.decidedRole;
  } catch (e) {
    console.warn("[reporte] strongCheckIsRevisor:", e instanceof Error ? e.message : String(e));
  }

  if (role !== "revisor") {
    return redirect("/platform?error=" + encodeURIComponent("Esta sección es sólo para revisores."));
  }

  const sections = buildSections(role);
  const sp = await searchParams;
  const options = closedMonthOptions();
  const selectedMonth = options.some((o) => o.value === firstParam(sp, "mes"))
    ? firstParam(sp, "mes")
    : options[0]?.value ?? addMonths(currentMonthKeyUtc(), -1);
  const selectedSupervisor = firstParam(sp, "supervisor");
  const currentMonth = currentMonthKeyUtc();

  const client = getReportAdminClient();

  if (!client) {
    return (
      <PlatformShell
        sections={sections}
        currentUserId={user.id}
        currentUserEmail={user.email ?? undefined}
      >
        <div className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-6">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Reporte</h1>
          <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
            Falta configurar <span className="font-mono">SUPABASE_SERVICE_ROLE_KEY</span> para
            calcular y emitir el Reporte Mensual de Cumplimiento.
          </div>
        </div>
      </PlatformShell>
    );
  }

  const catalog: ReportSupervisorInfo[] = await fetchSupervisorCatalog(client);
  const supervisorFilter = selectedSupervisor
    ? catalog.find((s) => s.email === selectedSupervisor.toLowerCase()) ??
      (selectedSupervisor.includes("@")
        ? { id: selectedSupervisor, email: selectedSupervisor.toLowerCase(), nombre: selectedSupervisor }
        : null)
    : null;

  const userCtx = {
    id: user.id,
    email: (user.email ?? "").trim().toLowerCase(),
    nombre: (user.email ?? "").split("@")[0] ?? "Revisor",
  };

  let preview: MonthlyReport | null = null;
  let previewError: string | null = null;
  try {
    preview = await previewMonthlyReport(client, {
      monthKey: selectedMonth,
      parcial: false,
      supervisor: supervisorFilter ? { email: supervisorFilter.email, nombre: supervisorFilter.nombre } : null,
      user: userCtx,
    });
  } catch (e) {
    previewError = e instanceof Error ? e.message : "No se pudo calcular el reporte.";
    console.error("[reporte] preview error:", previewError);
  }

  let historial: ReportHistoryEntry[] = [];
  try {
    historial = await listHistorial(client, 40);
  } catch (e) {
    console.warn("[reporte] historial:", e instanceof Error ? e.message : String(e));
  }

  const supervisorQuery = supervisorFilter ? `&supervisor=${encodeURIComponent(supervisorFilter.email)}` : "";
  const oficialHref = `/api/reporte/mensual?mes=${encodeURIComponent(selectedMonth)}${supervisorQuery}`;
  const parcialHref = `/api/reporte/mensual?mes=${encodeURIComponent(currentMonth)}${supervisorQuery}&parcial=true`;

  const kpis = preview?.kpis;
  const comparativo = preview?.comparativo ?? [];
  const findComp = (key: string) => comparativo.find((c) => c.key === key);

  return (
    <PlatformShell
      sections={sections}
      currentUserId={user.id}
      currentUserEmail={user.email ?? undefined}
    >
      <div className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Reporte</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Reporte Mensual de Cumplimiento ·{" "}
              <span className="font-medium text-zinc-700">{monthLabelEs(selectedMonth)}</span>
              {supervisorFilter ? ` · ${supervisorFilter.nombre}` : ""}
            </p>
          </div>
        </div>

        {/* Filtros */}
        <form
          method="get"
          className="mt-5 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 sm:flex-row sm:items-end"
        >
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Mes (solo meses cerrados)
            <select
              name="mes"
              defaultValue={selectedMonth}
              className="h-10 min-w-[180px] rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900"
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Supervisor (opcional)
            <select
              name="supervisor"
              defaultValue={supervisorFilter?.email ?? ""}
              className="h-10 min-w-[240px] rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900"
            >
              <option value="">Todos los supervisores</option>
              {catalog.map((s) => (
                <option key={s.email} value={s.email}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            className="h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
          >
            Ver indicadores
          </button>
        </form>

        {/* Descargas */}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <a
            href={oficialHref}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-[#032F6C] px-5 text-sm font-medium text-white transition-colors hover:bg-[#023674]"
          >
            Descargar reporte mensual (PDF)
          </a>
          <a
            href={parcialHref}
            className="inline-flex h-11 items-center justify-center rounded-lg border border-[#009ADD] px-5 text-sm font-medium text-[#032F6C] transition-colors hover:bg-[#009ADD]/10"
          >
            Avance parcial de {monthLabelLowerEs(currentMonth)} (PDF)
          </a>
        </div>

        {/* Vista previa de KPIs */}
        <section className="mt-8">
          <h2 className="text-sm font-semibold tracking-tight text-zinc-900">
            Vista previa de {monthLabelEs(selectedMonth)}
          </h2>

          {previewError ? (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              {previewError}
            </div>
          ) : !preview || preview.meta.sinDatos || !kpis ? (
            <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600">
              No hay asignaciones registradas para {monthLabelEs(selectedMonth)}
              {supervisorFilter ? ` del supervisor ${supervisorFilter.nombre}` : ""}. El reporte se
              puede descargar y quedará constancia de la consulta.
            </div>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                <KpiCell
                  label="% Cumplimiento"
                  value={formatPct(kpis.cumplimiento)}
                  comparison={findComp("cumplimiento")}
                />
                <KpiCell label="Asignadas" value={String(kpis.total)} comparison={findComp("total")} />
                <KpiCell
                  label="Completadas"
                  value={String(kpis.completadas)}
                  comparison={findComp("completadas")}
                />
                <KpiCell
                  label="Completadas extemporáneas"
                  value={String(kpis.extemporaneas)}
                  comparison={findComp("extemporaneas")}
                />
                <KpiCell
                  label="Entregadas (sin revisar)"
                  value={String(kpis.entregadas)}
                  comparison={findComp("entregadas")}
                />
                <KpiCell
                  label="Pendientes"
                  value={String(kpis.pendientes)}
                  comparison={findComp("pendientes")}
                />
                <KpiCell
                  label="Atrasadas"
                  value={String(kpis.atrasadas)}
                  comparison={findComp("atrasadas")}
                />
                <KpiCell
                  label="Tiempo promedio de entrega"
                  value={
                    kpis.tiempoPromedioEntregaDias === null
                      ? "—"
                      : `${kpis.tiempoPromedioEntregaDias.toFixed(1)} días`
                  }
                  comparison={findComp("tiempoPromedioEntregaDias")}
                />
                <KpiCell
                  label="Entregas a tiempo"
                  value={formatPct(kpis.porcentajeEntregasATiempo)}
                  comparison={findComp("porcentajeEntregasATiempo")}
                />
                <KpiCell label="Supervisores con datos" value={String(preview.supervisores.length)} />
              </div>

              {preview.resumenEjecutivo.length > 0 ? (
                <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Resumen ejecutivo
                  </p>
                  <ul className="mt-2 space-y-1.5 text-sm text-zinc-700">
                    {preview.resumenEjecutivo.map((line, index) => (
                      <li key={index} className="flex gap-2">
                        <span className="text-[#009ADD]">•</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </section>

        {/* Historial */}
        <section className="mt-8">
          <h2 className="text-sm font-semibold tracking-tight text-zinc-900">
            Historial de reportes generados
          </h2>

          {historial.length === 0 ? (
            <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600">
              Todavía no se ha generado ningún reporte.
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-xl border border-zinc-200 bg-white">
              <table className="w-full min-w-[860px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                    <th className="px-4 py-3 font-medium">Folio</th>
                    <th className="px-4 py-3 font-medium">Mes</th>
                    <th className="px-4 py-3 font-medium">Tipo</th>
                    <th className="px-4 py-3 font-medium">Cumplimiento</th>
                    <th className="px-4 py-3 font-medium">Generado</th>
                    <th className="px-4 py-3 font-medium">Descargado por</th>
                    <th className="px-4 py-3 font-medium text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {historial.map((entry) => (
                    <tr key={entry.id} className="border-b border-zinc-100 last:border-0">
                      <td className="px-4 py-3 font-mono text-xs text-zinc-700">{entry.folio}</td>
                      <td className="px-4 py-3 text-zinc-800">{entry.monthLabel}</td>
                      <td className="px-4 py-3 text-zinc-600">
                        {entry.parcial ? "Avance parcial" : "Cierre oficial"}
                      </td>
                      <td className="px-4 py-3 text-zinc-800">
                        {entry.cumplimiento === null ? "—" : `${entry.cumplimiento.toFixed(1)}%`}
                      </td>
                      <td className="px-4 py-3 text-zinc-600">{entry.generadoEnLabel}</td>
                      <td className="px-4 py-3 text-zinc-600">
                        {entry.generadoPorNombre ?? entry.generadoPorEmail ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <a
                          href={`/api/reporte/mensual?id=${encodeURIComponent(entry.id)}&disposition=inline`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-medium text-[#032F6C] underline-offset-2 hover:underline"
                        >
                          Ver
                        </a>
                        <span className="mx-2 text-zinc-300">|</span>
                        <a
                          href={`/api/reporte/mensual?id=${encodeURIComponent(entry.id)}`}
                          className="text-xs font-medium text-[#032F6C] underline-offset-2 hover:underline"
                        >
                          Descargar
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </PlatformShell>
  );
}
