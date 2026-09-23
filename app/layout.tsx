import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
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
  title: "Promas Icave",
  description: "Gestor SoS",
  applicationName: "Promas ICAVE",
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
    title: "Promas Icave",
    description: "Gestor SoS",
    images: [
      {
        url: FAVICON_URL,
        type: "image/svg+xml",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "Promas Icave",
    description: "Gestor SoS",
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
  return (
    <html lang="en" className={`${geistMono.variable} h-full antialiased overflow-x-hidden`}>
      <body className="min-h-full flex flex-col overflow-x-hidden">{children}</body>
    </html>
  );
}
