"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const STORAGE_KEY = "icave_cookie_consent";

export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) !== "accepted") {
        setVisible(true);
      }
    } catch {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const accept = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "accepted");
    } catch {
      // Sin acceso a localStorage: se cerrará solo durante esta sesión.
    }
    setVisible(false);
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 fixed inset-x-4 bottom-4 z-[9999] duration-200 sm:inset-x-auto sm:right-6 sm:bottom-6">
      <div className="max-w-md rounded-2xl bg-white p-4 shadow-lg ring-1 ring-inset ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800">
        <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
          Uso de cookies
        </p>
        <p className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
          Utilizamos cookies necesarias para el funcionamiento y la seguridad de la
          plataforma. Al continuar, aceptas su uso. Consulta nuestras{" "}
          <Link
            href="/politicas"
            className="font-medium text-zinc-900 underline underline-offset-2 transition-colors hover:text-zinc-600 dark:text-zinc-100 dark:hover:text-zinc-400"
          >
            políticas
          </Link>
          .
        </p>
        <button
          type="button"
          onClick={accept}
          className="mt-3 h-10 w-full rounded-full bg-zinc-900 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Aceptar
        </button>
      </div>
    </div>
  );
}
