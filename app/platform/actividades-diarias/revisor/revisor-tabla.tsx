import { formatCalendarDateShort } from "@/lib/calendar-date";
import {
  detalleActividadLabel,
  tipoLabel,
  type ActividadDiariaRow,
} from "@/app/platform/actividades-diarias/tipos";
import { FileText } from "@/components/ui/icons";

export function RevisorTabla({ rows }: { rows: ActividadDiariaRow[] }) {
  if (rows.length === 0) {
    return (
      <section className="rounded-[1.75rem] border border-[#e6e8ec] bg-white p-8 text-center shadow-[0_1px_2px_rgba(20,20,20,0.04)]">
        <div className="text-4xl">📋</div>
        <h2 className="mt-4 text-[18px] font-semibold text-[#141414]">
          Todavía no hay actividades registradas
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#5f6775]">
          Cuando los supervisores registren actividades ordinarias o extraordinarias, aparecerán
          aquí con sus detalles y PDFs.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[1.75rem] border border-[#e6e8ec] bg-white shadow-[0_1px_2px_rgba(20,20,20,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-2 px-6 pt-6 sm:px-8">
        <h2 className="text-[19px] font-semibold tracking-[-0.02em] text-[#141414]">
          Actividades enviadas
        </h2>
        <span className="text-sm text-[#8b93a1]">
          {rows.length} registro{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-4 overflow-x-auto px-2 pb-2 sm:px-4">
        <table className="w-full min-w-[1500px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[#eceef2] text-xs uppercase tracking-[0.06em] text-[#8b93a1]">
              <th className="px-3 py-3 font-medium">Fecha</th>
              <th className="px-3 py-3 font-medium">Supervisor</th>
              <th className="px-3 py-3 font-medium">Puesto</th>
              <th className="px-3 py-3 font-medium">Turno</th>
              <th className="px-3 py-3 font-medium">Tipo</th>
              <th className="px-3 py-3 font-medium">Tipo act.</th>
              <th className="px-3 py-3 font-medium">Área</th>
              <th className="px-3 py-3 font-medium">Categoría</th>
              <th className="px-3 py-3 font-medium">Subcategoría</th>
              <th className="px-3 py-3 font-medium">Actividad</th>
              <th className="px-3 py-3 font-medium">Detalle</th>
              <th className="px-3 py-3 font-medium">PDF</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const pdfName =
                row.file_name?.trim() || row.file_path?.split("/").pop() || "actividad.pdf";
              const pdfBase = `/platform/actividades-diarias/download/${encodeURIComponent(
                pdfName,
              )}?id=${row.id}`;

              return (
                <tr key={row.id} className="border-b border-[#f2f3f6] align-top last:border-0">
                  <td className="whitespace-nowrap px-3 py-3.5 text-[#2b2926]">
                    {formatCalendarDateShort(row.fecha)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3.5 text-[#5f6775]">
                    {row.user_email ?? "—"}
                  </td>
                  <td className="px-3 py-3.5 text-[#2b2926]">{row.puesto?.nombre || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-3.5 text-[#5f6775]">
                    {row.turno?.nombre || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3.5 text-[#5f6775]">
                    {tipoLabel(row.tipo) || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3.5 text-[#5f6775]">
                    {row.tipo_actividad?.nombre || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3.5 text-[#5f6775]">
                    {row.area?.nombre || "—"}
                  </td>
                  <td className="px-3 py-3.5 text-[#5f6775]">
                    {row.categoria_actividad || "—"}
                  </td>
                  <td className="px-3 py-3.5 text-[#5f6775]">
                    {row.subcategoria_actividad || "—"}
                  </td>
                  <td className="px-3 py-3.5 text-[#2b2926]">
                    {row.nombre_actividad || row.actividad?.nombre || "—"}
                  </td>
                  <td className="max-w-[360px] px-3 py-3.5 text-[#5f6775]">
                    {detalleActividadLabel(row.detalle_actividad)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3.5">
                    {row.file_path ? (
                      <div className="space-y-1.5">
                        <span
                          className="block max-w-[220px] truncate font-medium text-[#2b2926]"
                          title={pdfName}
                        >
                          {pdfName}
                        </span>
                        <div className="flex items-center gap-3">
                          <a
                            href={pdfBase}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-[#0f766e] hover:underline"
                          >
                            <FileText size={15} />
                            Ver
                          </a>
                          <a
                            href={`${pdfBase}&disposition=attachment`}
                            className="text-[#2b2926] hover:underline"
                          >
                            Descargar
                          </a>
                        </div>
                      </div>
                    ) : (
                      <span className="text-[#b4bac4]">Sin adjunto</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
