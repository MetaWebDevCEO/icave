import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import { FlashNotifications } from "@/components/flash-notifications";
import "sileo/styles.css";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const FAVICON_URL = "/iso (2).svg";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

export const metadata: Metadata = {
  title: "Promas ICAVE",
  description:
    "Plataforma de gestion operativa de Icave: acceso, seguimiento de actividades, asignacion de tareas, carga de archivos y monitoreo. Desarrollada por MetaWeb Dev Solutions.",
  applicationName: "Promas ICAVE",
  authors: [{ name: "MetaWeb Dev Solutions" }],
  appleWebApp: {
    capable: true,
    title: "Promas ICAVE",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: FAVICON_URL, type: "image/svg+xml", rel: "icon" },
      { url: FAVICON_URL, type: "image/svg+xml", rel: "shortcut icon" },
      { url: "/favicon.svg", type: "image/svg+xml", rel: "icon" },
    ],
    apple: [{ url: "/apple-touch-icon.svg", type: "image/svg+xml" }],
    other: [
      { rel: "mask-icon", url: FAVICON_URL, type: "image/svg+xml" },
      { rel: "alternate icon", url: FAVICON_URL, type: "image/svg+xml" },
    ],
  },
  openGraph: {
    type: "website",
    siteName: "Promas ICAVE",
    title: "Promas ICAVE",
    description:
      "Plataforma de gestion operativa de Icave desarrollada por MetaWeb Dev Solutions.",
    images: [
      {
        url: FAVICON_URL,
        type: "image/svg+xml",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "Promas ICAVE",
    description:
      "Plataforma de gestion operativa de Icave desarrollada por MetaWeb Dev Solutions.",
    images: [FAVICON_URL],
  },
  metadataBase: (() => {
    const candidates = [
      process.env.NEXT_PUBLIC_SITE_URL,
      process.env.NEXT_PUBLIC_APP_URL,
      process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : undefined,
      process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
      process.env.NODE_ENV === "production"
        ? undefined
        : "http://localhost:3000",
    ];
    for (const raw of candidates) {
      if (typeof raw !== "string") continue;
      const v = raw.trim().replace(/\/$/, "");
      if (!v) continue;
      try {
        return new URL(v);
      } catch {
        continue;
      }
    }
    return undefined;
  })(),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Promas ICAVE",
    description: "Plataforma de gestion de acceso, seguimiento de actividades, asignacion de tareas y monitoreo operativo de Icave.",
    publisher: {
      "@type": "Organization",
      name: "ICAVE",
    },
    author: {
      "@type": "Organization",
      name: "MetaWeb Dev Solutions",
      description: "Empresa de desarrollo de software responsable del desarrollo, diseno y creacion de la plataforma Promas ICAVE.",
    },
  };

  return (
    <html lang="es" className={`${geistMono.variable} h-full antialiased overflow-x-hidden`}>
      <body className="min-h-full flex flex-col overflow-x-hidden">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
        <FlashNotifications />
      </body>
    </html>
  );
}
