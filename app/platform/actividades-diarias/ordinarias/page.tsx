import Link from "next/link";

export const dynamic = "force-dynamic";

export default function ActividadesOrdinariasPage() {
  return (
    <div className="min-h-screen bg-[#f4f5f7] font-sans text-[#141414]">
      <main className="mx-auto w-full max-w-6xl px-6 py-10">
        <Link
          href="/platform/actividades-diarias"
          className="text-sm font-medium text-[#0f766e] hover:underline"
        >
          ← Volver a Actividades diarias
        </Link>
        <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.03em] text-[#141414]">
          Actividades Ordinarias
        </h1>
      </main>
    </div>
  );
}
