import type { NextConfig } from "next";

const isVercel = process.env.VERCEL === "1";

const nextConfig: NextConfig = {
  ...(isVercel ? {} : { distDir: ".next-build" }),
  experimental: {
    serverActions: {
      bodySizeLimit: "1000mb",
    },
  },
};

export default nextConfig;
