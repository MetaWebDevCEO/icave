"use client";

import { useRouter } from "next/navigation";
import { BarChart3, Mail, User, FolderKanban, Clock, CheckCircle2, MessageCircle } from "lucide-react";

type SupervisorCard = {
  id: string;
  email: string | null;
  createdAt: string | null;
  displayName: string;
  jobTitle: string;
  avatarUrl: string | null;
};

function initialsFromName(name: string) {
  const parts = name.split(/\s+/g).filter(Boolean);
  const first = parts[0]?.[0] ?? "S";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] : "";
  return (first + last).toUpperCase();
}

export function SupervisoresCards({
  supervisores,
}: {
  supervisores: SupervisorCard[];
}) {
  const router = useRouter();

  if (supervisores.length === 0) {
    return (
      <div className="relative mt-8 overflow-hidden rounded-3xl border border-zinc-200/80 bg-white p-20 text-center shadow-sm dark:border-zinc-800/60 dark:bg-zinc-950/60">
        <div
          className="pointer-events-none absolute inset-0 z-0 bg-[image:url(/logo.svg)] bg-[length:55%_auto] bg-no-repeat bg-[position:center_78%] opacity-[0.04] dark:opacity-[0.03] mix-blend-multiply dark:mix-blend-screen"
          aria-hidden="true"
        />
        <div className="relative z-10 mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
          <User className="h-7 w-7" strokeWidth={1.8} />
        </div>
        <h3 className="relative z-10 mt-5 text-base font-semibold text-zinc-800 dark:text-zinc-200">
          No hay supervisores registrados
        </h3>
        <p className="relative z-10 mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Los supervisores aparecerán aquí cuando sean dados de alta en el sistema.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8 grid grid-cols-1 gap-8 sm:grid-cols-2 xl:grid-cols-3">
      {supervisores.map((s) => {
        const initials = initialsFromName(s.displayName || "Supervisor");
        const name = s.displayName || "Sin nombre";

        return (
          <div
            key={s.id}
            className="group relative flex flex-col overflow-hidden rounded-3xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)] ring-1 ring-zinc-200/70 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(15,23,42,0.06),0_20px_40px_-18px_rgba(15,23,42,0.18)] hover:ring-zinc-300 dark:bg-zinc-950/60 dark:ring-zinc-800/70 dark:hover:ring-zinc-700"
          >
            <div
              className="pointer-events-none absolute inset-0 z-0 bg-[image:url(/logo.svg)] bg-[length:85%_auto] bg-no-repeat bg-[position:center_78%] opacity-[0.045] dark:opacity-[0.035] mix-blend-multiply dark:mix-blend-screen"
              aria-hidden="true"
            />

            <div className="relative h-36 w-full overflow-hidden rounded-t-[calc(1.5rem-1px)] bg-gradient-to-br from-[#023674] via-[#0D4A8B] to-[#02A9E5] dark:from-[#023674] dark:via-[#092f5c] dark:to-[#0b3b75]">
              <div className="absolute inset-0 bg-gradient-to-t from-white/0 via-white/0 to-black/5 dark:to-black/20" />
            </div>

            <div className="relative z-10 flex flex-1 flex-col px-8 pb-8">
              <div className="-mt-16 flex justify-center">
                <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-full bg-zinc-200 text-2xl font-semibold text-zinc-700 shadow-[0_8px_24px_-8px_rgba(15,23,42,0.22)] ring-[6px] ring-white dark:bg-zinc-700 dark:text-zinc-200 dark:ring-zinc-950/80">
                  {s.avatarUrl ? (
                    <img
                      src={s.avatarUrl}
                      alt={`Avatar de ${name}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    initials
                  )}
                </div>
              </div>

              <div className="mt-5 text-center">
                <h3 className="truncate text-2xl font-semibold leading-tight tracking-tight text-zinc-900 dark:text-zinc-100">
                  {name}
                </h3>
                <p className="mt-2 text-lg font-medium text-[#023674] dark:text-[#6bb4ff]">
                  {s.jobTitle}
                </p>
              </div>

              <div className="mt-5 flex items-center justify-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                <Mail className="h-4 w-4 flex-shrink-0" strokeWidth={1.8} />
                <span className="truncate">{s.email || "Sin correo"}</span>
              </div>

              <div className="mt-7 grid grid-cols-3 divide-x divide-zinc-200/80 text-center dark:divide-zinc-800/80">
                <div className="px-2">
                  <div className="flex items-end justify-center gap-1">
                    <FolderKanban className="h-4 w-4 text-[#023674] dark:text-[#6bb4ff]" strokeWidth={1.8} />
                    <span className="text-xl font-semibold text-zinc-800 dark:text-zinc-200">—</span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Asignados</p>
                </div>
                <div className="px-2">
                  <div className="flex items-end justify-center gap-1">
                    <Clock className="h-4 w-4 text-[#023674] dark:text-[#6bb4ff]" strokeWidth={1.8} />
                    <span className="text-xl font-semibold text-zinc-800 dark:text-zinc-200">—</span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">En curso</p>
                </div>
                <div className="px-2">
                  <div className="flex items-end justify-center gap-1">
                    <CheckCircle2 className="h-4 w-4 text-[#023674] dark:text-[#6bb4ff]" strokeWidth={1.8} />
                    <span className="text-xl font-semibold text-zinc-800 dark:text-zinc-200">—</span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Completados</p>
                </div>
              </div>

              <div className="mt-7 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() =>
                    router.push(`/platform/supervisores/${s.id}/estadisticas`)
                  }
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#023674] px-4 py-3.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-[#063f85] active:scale-[0.98] dark:bg-[#02A9E5] dark:text-zinc-950 dark:hover:bg-[#28b9ee]"
                >
                  <BarChart3 className="h-4.5 w-4.5" strokeWidth={2} />
                  Estadísticas
                </button>
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3.5 text-sm font-semibold text-[#023674] transition-all duration-200 hover:bg-[#023674]/[0.04] active:scale-[0.98] dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-[#6bb4ff] dark:hover:bg-[#6bb4ff]/[0.08]"
                >
                  <MessageCircle className="h-4.5 w-4.5" strokeWidth={2} />
                  Contactar
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
