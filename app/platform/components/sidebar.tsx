"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

export type SidebarNavItem = {
  title: string;
  href: string;
};

export type SidebarSection = {
  title: string;
  items: SidebarNavItem[];
};

export function Sidebar({
  sections,
  open,
  onClose,
  userLabel,
}: {
  sections: SidebarSection[];
  open: boolean;
  onClose: () => void;
  userLabel?: string;
}) {
  const pathname = usePathname();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const displayLabel = (userLabel ?? "Cuenta").trim() || "Cuenta";
  const secondaryLabel = displayLabel.includes("@") ? "" : "";
  const initials = displayLabel
    .split(/[\s@._-]+/g)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  useEffect(() => {
    let cancelled = false;

    async function loadAvatar() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const metadata =
        user?.user_metadata && typeof user.user_metadata === "object"
          ? (user.user_metadata as Record<string, unknown>)
          : null;

      const bucket =
        metadata && typeof metadata.avatar_bucket === "string"
          ? metadata.avatar_bucket.trim()
          : "";
      const path =
        metadata && typeof metadata.avatar_path === "string"
          ? metadata.avatar_path.trim()
          : "";

      if (!bucket || !path) {
        if (!cancelled) setAvatarUrl(null);
        return;
      }

      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 10);

      if (cancelled) return;

      if (error || !data?.signedUrl) {
        setAvatarUrl(null);
        return;
      }

      setAvatarUrl(data.signedUrl);
    }

    loadAvatar();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Cerrar menú"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
        />
      )}

      <aside
        className={[
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black",
          "transform transition-transform md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="flex h-14 items-center border-b border-zinc-200 px-4 dark:border-zinc-800">
          <Link
            href="/platform"
            className="flex items-center gap-3 font-semibold tracking-tight text-zinc-950 dark:text-zinc-50"
            onClick={onClose}
          >
            <Image
              src="/iso%20(2).svg"
              alt="Icave"
              width={26}
              height={26}
              className="h-[26px] w-[26px] object-contain"
            />
            Promas Icave
          </Link>
        </div>

        <nav className="flex-1 p-2">
          <div className="grid gap-4">
            {sections.map((section) => {
              return (
                <div key={section.title}>
                  <div className="px-2 py-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    {section.title}
                  </div>
                  <div className="grid gap-1">
                    {section.items.map((item) => {
                      const active =
                        pathname === item.href ||
                        (item.href !== "/platform" &&
                          pathname?.startsWith(item.href));

                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={onClose}
                          className={[
                            "flex h-10 items-center rounded-md px-3 text-sm transition-colors",
                            active
                              ? "bg-zinc-100 text-zinc-950 dark:bg-zinc-900 dark:text-zinc-50"
                              : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900/60",
                          ].join(" ")}
                        >
                          {item.title}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </nav>

        <div className="border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
          <div className="group relative">
            <div className="pointer-events-none absolute bottom-full left-0 right-0 mb-2 translate-y-2 opacity-0 transition duration-150 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100">
              <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_18px_40px_rgba(15,23,42,0.16)] dark:border-zinc-800 dark:bg-zinc-950">
                <Link
                  href="/platform/configuracion"
                  onClick={onClose}
                  className="flex w-full items-center px-4 py-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                >
                  Configuracion
                </Link>
                <form action="/auth/signout" method="post">
                  <button
                    type="submit"
                    className="flex w-full items-center border-t border-zinc-200 px-4 py-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 hover:text-zinc-950 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                  >
                    Salir
                  </button>
                </form>
              </div>
            </div>

            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-2xl bg-zinc-50 px-3 py-3 text-left transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 dark:bg-zinc-950 dark:hover:bg-zinc-900 dark:focus-visible:ring-zinc-700"
            >
              <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-[radial-gradient(circle_at_30%_30%,#DDD6C9_0%,#C6B8A8_45%,#8A7867_100%)] text-sm font-semibold text-white shadow-sm">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={`Avatar de ${displayLabel}`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  initials || "U"
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                  {displayLabel}
                </span>
                <span className="mt-1 block truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {secondaryLabel}
                </span>
              </span>
              <span className="text-xs font-medium text-zinc-400 transition-colors group-hover:text-zinc-600 group-focus-within:text-zinc-600 dark:text-zinc-500 dark:group-hover:text-zinc-300 dark:group-focus-within:text-zinc-300">
              </span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
