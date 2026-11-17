import Image from "next/image";
import Link from "next/link";
import { MURO_MODULOS, type MuroModulo } from "@/app/platform/modulos-config";
import type { UserRole } from "@/lib/platform-roles";

export function ModulosGrid({ role }: { role: UserRole }) {
  return (
    <div className="space-y-7">
      <ClassroomSection title="Módulos">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {MURO_MODULOS.map((m) => (
            <ModuloCard key={m.id} modulo={m} role={role} />
          ))}
        </div>
      </ClassroomSection>
    </div>
  );
}

function ClassroomSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[2rem] border border-white bg-white px-8 py-7 shadow-[0_1px_2px_rgba(20,20,20,0.03)] sm:px-10 sm:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-[#141414]">
          {title}
        </h2>
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function ModuloCard({ modulo, role }: { modulo: MuroModulo; role: UserRole }) {
  const href = typeof modulo.href === "string" ? modulo.href : modulo.href[role];
  return (
    <Link
      href={href}
      aria-label={`Acceder a ${modulo.nombre}`}
      className="group relative flex aspect-[4/3] w-full overflow-hidden rounded-[1.75rem] border border-[#d9dee7] transition-all duration-200 hover:-translate-y-1 hover:border-[#c9cfdc] hover:shadow-[0_18px_60px_rgba(3,47,108,0.22)]"
    >
      {modulo.bannerImage ? (
        <Image
          src={modulo.bannerImage}
          alt={`Portada de ${modulo.nombre}`}
          fill
          priority
          sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw"
          className="object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(135deg, ${modulo.accent} 0%, color-mix(in srgb, ${modulo.accent} 35%, #04142e) 100%)`,
          }}
        />
      )}

      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,10,22,0.05)_0%,rgba(6,10,22,0.35)_55%,rgba(6,10,22,0.82)_100%)]" />

      {modulo.estado === "proximamente" && (
        <span className="absolute right-5 top-5 z-10 rounded-full bg-white/15 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-white backdrop-blur-sm">
          Próximamente
        </span>
      )}

      <div className="relative z-10 flex h-full w-full flex-col justify-end px-9 pb-8 pt-10 sm:px-10">
        <div className="text-[30px] font-semibold leading-tight tracking-[-0.03em] text-white drop-shadow-sm sm:text-[34px]">
          {modulo.nombre}
        </div>
        <div className="mt-2 text-[15px] font-medium text-white/90 sm:text-[16px]">
          {modulo.subtitulo}
        </div>
      </div>
    </Link>
  );
}
