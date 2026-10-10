"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

type ServerActionResult = {
  ok: boolean;
  url?: string | null;
  error?: string | null;
};

export function ProfileFormClient({
  action,
  defaultValues,
}: {
  action: (formData: FormData) => Promise<ServerActionResult>;
  defaultValues: {
    full_name: string;
    username: string;
    headline: string;
    bio: string;
    location: string;
  };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <form
      action={async (formData) => {
        startTransition(async () => {
          try {
            const res = await action(formData);
            if (res?.url) {
              router.replace(res.url);
            }
          } catch (e) {
            // Si la Server Action lanzó NEXT_REDIRECT por alguna razon,
            // no propagar a la UI.
            const msg =
              e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
            if (msg.includes("NEXT_REDIRECT")) {
              router.replace("/platform/configuracion");
              return;
            }
            router.replace(
              "/platform/configuracion?error=" + encodeURIComponent(msg || "Error desconocido.")
            );
          }
        });
      }}
      className="grid gap-5"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="grid gap-2">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Nombre
          </span>
          <input
            type="text"
            name="full_name"
            defaultValue={defaultValues.full_name}
            className="h-11 border-0 border-b border-zinc-300 bg-transparent px-0 text-sm text-zinc-950 outline-none transition-colors focus:border-[#003373] focus:ring-0 dark:border-zinc-700 dark:text-zinc-50"
          />
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Usuario
          </span>
          <input
            type="text"
            name="username"
            defaultValue={defaultValues.username}
            className="h-11 border-0 border-b border-zinc-300 bg-transparent px-0 text-sm text-zinc-950 outline-none transition-colors focus:border-[#003373] focus:ring-0 dark:border-zinc-700 dark:text-zinc-50"
          />
        </label>
      </div>

      <div className="grid gap-5">
        <label className="grid gap-2">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Cargo / Titulo
          </span>
          <input
            type="text"
            name="headline"
            defaultValue={defaultValues.headline}
            className="h-11 border-0 border-b border-zinc-300 bg-transparent px-0 text-sm text-zinc-950 outline-none transition-colors focus:border-[#003373] focus:ring-0 dark:border-zinc-700 dark:text-zinc-50"
          />
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Biografia
          </span>
          <textarea
            name="bio"
            defaultValue={defaultValues.bio}
            rows={4}
            className="min-h-[110px] border-0 border-b border-zinc-300 bg-transparent px-0 py-2 text-sm text-zinc-950 outline-none transition-colors focus:border-[#003373] focus:ring-0 dark:border-zinc-700 dark:text-zinc-50"
          />
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Ubicacion
          </span>
          <input
            type="text"
            name="location"
            defaultValue={defaultValues.location}
            className="h-11 border-0 border-b border-zinc-300 bg-transparent px-0 text-sm text-zinc-950 outline-none transition-colors focus:border-[#003373] focus:ring-0 dark:border-zinc-700 dark:text-zinc-50"
          />
        </label>
      </div>

      <div className="flex items-center justify-end gap-3">
        <a
          href="/platform"
          className="inline-flex h-11 items-center justify-center border-b border-zinc-300 px-1 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-500 hover:text-zinc-950 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-zinc-50"
        >
          Cancelar
        </a>
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex h-11 items-center justify-center border-b-2 border-[#003373] px-1 text-sm font-medium text-[#003373] transition-colors hover:border-[#0A4A9E] hover:text-[#0A4A9E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A4A9E]/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-[#9FC2FF] dark:border-[#9FC2FF] dark:hover:text-white dark:hover:border-white"
        >
          {isPending ? "Guardando..." : "Guardar cambios"}
        </button>
      </div>
    </form>
  );
}
