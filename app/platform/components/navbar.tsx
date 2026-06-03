"use client";

export function Navbar({
  onMenuClick,
  userLabel,
}: {
  onMenuClick: () => void;
  userLabel?: string;
}) {
  const displayLabel = (userLabel ?? "Cuenta").trim() || "Cuenta";
  const initials = displayLabel
    .split(/[\s@._-]+/g)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  return (
    <header className="sticky top-0 z-30 border-b border-[#0A2E16] bg-[#100B40] text-white">
      <div className="flex h-14 items-center gap-3 px-4">
        <button
          type="button"
          aria-label="Abrir menú"
          onClick={onMenuClick}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/20 bg-white/10 text-white hover:bg-white/15 md:hidden"
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

        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="hidden flex-1 md:block">
            <input
              type="search"
              placeholder="Buscar..."
              className="h-10 w-full rounded-md border border-white/20 bg-white px-3 text-sm text-zinc-950 placeholder:text-zinc-500 outline-none focus:ring-2 focus:ring-white/60"
            />
          </div>
        </div>

        <button
          type="button"
          className="inline-flex h-9 items-center gap-2 rounded-md border border-white/20 bg-white/10 px-3 text-sm text-white hover:bg-white/15"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-[10px] font-semibold">
            {initials || "U"}
          </span>
          <span className="hidden max-w-[220px] truncate sm:inline">
            {displayLabel}
          </span>
        </button>
      </div>
    </header>
  );
}
