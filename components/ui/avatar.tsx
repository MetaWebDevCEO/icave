"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

function initialsOf(input?: string | null): string {
  if (!input) return "";
  const parts = String(input).trim().split(/\s+|@|[._-]+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (
    (parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")
  )
    .toUpperCase()
    .slice(0, 2);
}

export type AvatarProps = {
  src?: string | null;
  alt?: string;
  initials?: string;
  className?: string;
};

export function Avatar({ src, alt, initials, className }: AvatarProps) {
  const [errored, setErrored] = React.useState(false);
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const safeSrc =
    !errored && mounted && typeof src === "string" && src.length > 0
      ? src
      : null;

  return (
    <div
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-200 text-zinc-700 ring-1 ring-white/60 dark:bg-zinc-700 dark:text-zinc-200 dark:ring-zinc-900/40",
        className
      )}
      aria-label={alt || initials || "avatar"}
    >
      {safeSrc ? (
        <img
          src={safeSrc}
          alt={alt || initials || "avatar"}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          crossOrigin="anonymous"
          onError={() => setErrored(true)}
        />
      ) : (
        <span className="inline-flex h-full w-full items-center justify-center font-semibold leading-none">
          {initialsOf(initials || alt)}
        </span>
      )}
    </div>
  );
}

export default Avatar;
