import type { NextConfig } from "next";

const isVercel = process.env.VERCEL === "1";

const isDev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  ...(isVercel ? {} : { distDir: ".next-build" }),
  // Permite abrir el dev server tanto por localhost como por IP LAN
  // (192.168.x.x, etc.) sin que Next bloquee las conexiones.
  ...(isDev
    ? ({
        allowedDevOrigins: ["*"],
      } as NextConfig)
    : {}),
  experimental: {
    serverActions: {
      // PDF de 1-3 MB, 3 max → 30 MB. Antes era 1GB (MUY excesivo,
      // permitía requests gigantes que bogaban el server)
      bodySizeLimit: "30mb",
    },
    // Importa solo lo que usas de estas librerías (tree-shake heavy)
    optimizePackageImports: [
      "@supabase/supabase-js",
      "clsx",
      "class-variance-authority",
    ],
  },
  // Desactiva warnings ruidosos de "<URL> was preloaded but not used"
  // (aparecen por fontsource/iconos en modo dev LAN; no afectan el render).
  reactStrictMode: true,
  logging: {
    fetches: {
      fullUrl: false,
    },
  },
  devIndicators: {
    position: "top-right",
  },
};

export default nextConfig;
