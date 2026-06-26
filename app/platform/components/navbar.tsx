"use client";

import { usePathname } from "next/navigation";

function getPageTitle(pathname: string | null) {
  if (!pathname || pathname === "/platform") return "Dashboard";

  const segments = pathname
    .split("/")
    .filter(Boolean)
    .filter((segment) => segment !== "platform");

  if (segments.length === 0) return "Dashboard";

  const last = segments[segments.length - 1] ?? "Dashboard";
  return last.charAt(0).toUpperCase() + last.slice(1).replace(/-/g, " ");
}

export function Navbar({
  onMenuClick,
}: {
  onMenuClick: () => void;
}) {
  const pathname = usePathname();
  const pageTitle = getPageTitle(pathname);

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white text-zinc-900">
      <div className="flex h-24 items-center justify-between gap-3 px-4 md:px-5">
        <button
          type="button"
          aria-label="Abrir menú"
          onClick={onMenuClick}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 md:hidden"
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

        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight text-[#23283A] md:text-[2rem]">
            {pageTitle}
          </h1>
        </div>
      </div>
    </header>
  );
}
