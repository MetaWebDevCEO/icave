"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { sileo, Toaster } from "sileo";

function FlashListener() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const message = searchParams.get("message");
  const error = searchParams.get("error");
  const handledRef = useRef<string | null>(null);

  useEffect(() => {
    const current = error
      ? `error:${error}`
      : message
        ? `message:${message}`
        : null;

    if (!current) {
      handledRef.current = null;
      return;
    }

    if (handledRef.current === current) return;
    handledRef.current = current;

    if (error) {
      sileo.error({ title: "Error", description: error });
    } else if (message) {
      sileo.success({ title: "Listo", description: message });
    }

    // Limpia los parámetros para que el mismo aviso pueda repetirse
    // sin recargar ni dejar rastro en la barra de direcciones.
    const next = new URLSearchParams(searchParams.toString());
    next.delete("error");
    next.delete("message");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [error, message, pathname, router, searchParams]);

  return null;
}

export function FlashNotifications() {
  return (
    <>
      {/* sileo usa `theme="dark"` para píldoras claras (relleno blanco con texto oscuro). */}
      <Toaster
        position="top-right"
        theme="dark"
        options={{ fill: "#ffffff" }}
      />
      <Suspense fallback={null}>
        <FlashListener />
      </Suspense>
    </>
  );
}
