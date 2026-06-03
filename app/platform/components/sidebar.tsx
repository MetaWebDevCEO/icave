"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
}: {
  sections: SidebarSection[];
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();

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
          "fixed inset-y-0 left-0 z-50 w-64 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black",
          "transform transition-transform md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="flex h-14 items-center border-b border-zinc-200 px-4 dark:border-zinc-800">
          <Link
            href="/platform"
            className="font-semibold tracking-tight text-zinc-950 dark:text-zinc-50"
            onClick={onClose}
          >
            Promas Icave
          </Link>
        </div>

        <nav className="p-2">
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
      </aside>
    </>
  );
}
