"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { Sidebar, type SidebarSection } from "@/app/platform/components/sidebar";
import { createClient } from "@/utils/supabase/client";

export function PlatformShell({
  sections,
  children,
  currentUserId,
  currentUserEmail,
}: {
  sections: SidebarSection[];
  children?: ReactNode;
  currentUserId?: string;
  currentUserEmail?: string;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!currentUserId) return;

    const supabase = createClient();

    const channel = supabase.channel("online-users", {
      config: { presence: { key: currentUserId } },
    });

    channel.subscribe(async (status) => {
      if (status !== "SUBSCRIBED") return;
      await channel.track({ online_at: new Date().toISOString() });
    });

    const interval = setInterval(() => {
      channel.track({ online_at: new Date().toISOString() });
    }, 25000);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [currentUserId]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
      <Sidebar
        sections={sections}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        userLabel={currentUserEmail}
      />

      <div className="md:pl-64">
        <button
          type="button"
          aria-label="Abrir menú"
          onClick={() => setSidebarOpen(true)}
          className="fixed left-4 top-4 z-30 inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 md:hidden"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            className="h-4 w-4"
          >
            <path
              d="M4 6h16M4 12h16M4 18h16"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <main className="p-4 md:pt-4">
          {children ?? (
            <div className="mx-auto max-w-6xl">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                  <div className="text-sm font-medium">Resumen</div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    Cards placeholder estilo shadcn blocks.
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                  <div className="text-sm font-medium">Actividad</div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    Aquí puedes poner métricas o logs.
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                  <div className="text-sm font-medium">Estado</div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    Otro bloque de ejemplo.
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="text-sm font-medium">Contenido</div>
                <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  Construye aquí tu dashboard (tabla, charts, etc.).
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
