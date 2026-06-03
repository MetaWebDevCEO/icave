"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { Navbar } from "@/app/platform/components/navbar";
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
      />

      <div className="md:pl-64">
        <Navbar
          onMenuClick={() => setSidebarOpen(true)}
          userLabel={currentUserEmail}
        />

        <main className="p-4">
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
