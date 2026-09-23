import type { NextConfig } from "next";

const isVercel = process.env.VERCEL === "1";

const nextConfig: NextConfig = {
  ...(isVercel ? {} : { distDir: ".next-build" }),
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
};

export default nextConfig;
