"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";

export type SupervisorCardData = {
  id: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  stats: {
    completadas: number;
    enCurso: number;
    pendientes: number;
  };
};

export type MonthOption = { value: string; label: string };

type Props = {
  supervisores: SupervisorCardData[];
  monthValue: string;
  monthOptions: MonthOption[];
};

function MonthFilter({ value, options }: { value: string; options: MonthOption[] }) {
  const router = useRouter();

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    if (!next) return;
    const url = new URL(window.location.href);
    url.searchParams.set("month", next);
    router.replace(url.toString(), { scroll: false });
  };

  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="supervisores-month-filter"
        className="text-xs font-medium text-zinc-600 uppercase tracking-wide whitespace-nowrap"
      >
        Mes
      </label>
      <select
        id="supervisores-month-filter"
        value={value}
        onChange={onChange}
        className="h-9 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-800 shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function totalAsignaciones(s: SupervisorCardData["stats"]) {
  return s.completadas + s.enCurso + s.pendientes;
}

function progresoPorcentaje(s: SupervisorCardData["stats"]): number {
  const total = totalAsignaciones(s);
  if (total <= 0) return 0;
  const peso = s.completadas + s.enCurso * 0.5;
  return Math.round((peso / total) * 100);
}

function StatPill({
  label,
  value,
  colorHex,
}: {
  label: string;
  value: number;
  colorHex: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 flex-1">
      <div className="text-xl font-semibold leading-none" style={{ color: colorHex }}>
        {value}
      </div>
      <div
        className="text-[10px] font-medium tracking-wide uppercase"
        style={{ color: colorHex }}
      >
        {label}
      </div>
    </div>
  );
}

function SupervisorCard({ s }: { s: SupervisorCardData }) {
  const pct = progresoPorcentaje(s.stats);
  const total = totalAsignaciones(s.stats);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-zinc-200/80 p-5 flex flex-col gap-4 hover:shadow-md hover:border-zinc-300 transition-all">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">
          <Avatar
            src={s.avatarUrl}
            alt={s.displayName}
            initials={s.displayName || (s.email ?? undefined)}
            className="w-12 h-12 text-base ring-1 ring-zinc-200 dark:ring-zinc-200"
          />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-zinc-900 text-sm truncate">
            {s.displayName}
          </h3>
          <p className="text-xs text-zinc-500 truncate mt-0.5">
            {s.email ?? "Sin correo registrado"}
          </p>
          <p className="text-[11px] text-zinc-400 mt-1">
            {total} asignaci{total === 1 ? "ón" : "ones"} totales
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-zinc-600 uppercase tracking-wide">
            Proceso
          </span>
          <span className="text-[11px] font-semibold text-zinc-700">{pct}%</span>
        </div>
        <div className="w-full h-1.5 bg-zinc-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: "#eab308" }}
          />
        </div>
      </div>

      <div className="flex items-start justify-between gap-2 pt-1 border-t border-zinc-100">
        <StatPill label="Completadas" value={s.stats.completadas} colorHex="#023674" />
        <div className="w-px h-10 bg-zinc-100" />
        <StatPill label="En Curso" value={s.stats.enCurso} colorHex="#3b82f6" />
        <div className="w-px h-10 bg-zinc-100" />
        <StatPill label="Pendientes" value={s.stats.pendientes} colorHex="#f59e0b" />
      </div>
    </div>
  );
}

export function SupervisoresCards({ supervisores, monthValue, monthOptions }: Props) {
  if (supervisores.length === 0) {
    return (
      <div className="w-full space-y-4">
        <div className="flex justify-end">
          <MonthFilter value={monthValue} options={monthOptions} />
        </div>
        <div className="w-full py-16 flex flex-col items-center justify-center text-center">
          <div className="w-14 h-14 rounded-full bg-zinc-100 flex items-center justify-center mb-4">
            <svg
              className="w-7 h-7 text-zinc-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
              />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-zinc-700 mb-1">
            No hay supervisores con asignaciones en este mes
          </h3>
          <p className="text-xs text-zinc-500 max-w-sm">
            Intenta cambiar el mes del filtro o verifica que existan usuarios con el rol
            Supervisor asignado en la tabla de roles.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      <div className="flex justify-end">
        <MonthFilter value={monthValue} options={monthOptions} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {supervisores.map((s) => (
          <SupervisorCard key={s.id} s={s} />
        ))}
      </div>
    </div>
  );
}
