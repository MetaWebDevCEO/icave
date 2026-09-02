import { createClient } from "@/utils/supabase/server";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const errorParam = typeof sp.error === "string" ? sp.error : undefined;
  const messageParam = typeof sp.message === "string" ? sp.message : undefined;

  const isSupabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL.includes("__REPLACE_ME__") &&
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.includes("__REPLACE_ME__")
  );

  async function updatePassword(formData: FormData) {
    "use server";

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      redirect(
        "/auth/reset-password?error=" +
          encodeURIComponent("Faltan variables de entorno de Supabase.")
      );
    }

    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (!password || password.length < 6) {
      redirect(
        "/auth/reset-password?error=" +
          encodeURIComponent("La contraseña debe tener al menos 6 caracteres.")
      );
    }

    if (password !== confirmPassword) {
      redirect(
        "/auth/reset-password?error=" +
          encodeURIComponent("Las contraseñas no coinciden.")
      );
    }

    const supabase = await createClient();

    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();

    if (sessionError || !sessionData.session) {
      redirect(
        "/auth/forgot-password?error=" +
          encodeURIComponent(
            "El enlace de recuperación expiró o no es válido. Solicita uno nuevo."
          )
      );
    }

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      redirect(
        "/auth/reset-password?error=" + encodeURIComponent(error.message)
      );
    }

    await supabase.auth.signOut();

    redirect(
      "/?message=" +
        encodeURIComponent(
          "Contraseña actualizada correctamente. Ahora puedes iniciar sesión con tu nueva contraseña."
        )
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-white font-sans text-[#141414]">
      <main className="flex h-screen w-full items-center overflow-hidden">
        <div className="grid h-screen w-full overflow-hidden lg:grid-cols-[1fr_1fr]">
          <section className="relative hidden h-screen overflow-hidden lg:block">
            <Image
              src="/login.jpg"
              alt="Vista industrial para el acceso a la plataforma"
              fill
              priority
              className="object-cover"
              sizes="(max-width: 1024px) 100vw, 42vw"
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,7,17,0.2)_0%,rgba(4,7,17,0.4)_38%,rgba(4,7,17,0.9)_100%)]" />
            <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(23,37,84,0.58)_0%,rgba(3,7,18,0.1)_36%,rgba(7,12,25,0.72)_100%)]" />

            <div className="relative flex h-full flex-col justify-between p-10 text-white lg:p-12">
              <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.34em] text-white/78">
                <span>Promas ICAVE</span>
              </div>

              <div className="max-w-md">
                <p className="text-xs uppercase tracking-[0.3em] text-white/62">
                  Seguridad de cuenta
                </p>
                <h1 className="mt-4 max-w-sm text-5xl leading-[0.95] font-semibold lg:text-6xl">
                  Crea tu nueva contraseña
                </h1>
                <p className="mt-4 max-w-sm text-sm leading-6 text-white/76">
                  Elige una contraseña segura y fácil de recordar para mantener
                  protegida tu cuenta dentro de la plataforma.
                </p>
              </div>
            </div>
          </section>

          <section className="flex h-screen items-center overflow-hidden bg-white">
            <div className="w-full px-6 py-8 sm:px-10 lg:px-14 xl:px-20">
              <div className="mx-auto flex h-full max-h-[100vh] w-full max-w-[26rem] flex-col justify-center">
                <div className="flex items-center justify-center">
                  <Image
                    src="/logo.svg"
                    alt="Logo de la plataforma"
                    width={180}
                    height={48}
                    priority
                    className="h-auto w-[9.5rem] sm:w-[10.5rem]"
                  />
                </div>

                <div className="mt-10 text-center">
                  <h2 className="mt-4 text-4xl leading-none font-semibold tracking-[-0.05em] text-[#151515]">
                    Nueva contraseña
                  </h2>
                  <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-[#6f6a63]">
                    Ingresa tu nueva contraseña y confírmala para finalizar el
                    proceso de recuperación.
                  </p>
                </div>

                {!isSupabaseConfigured && (
                  <div className="mt-6 rounded-[1.35rem] bg-amber-50/90 px-5 py-4 text-sm text-amber-900">
                    <div className="font-medium">Falta configurar Supabase</div>
                    <div className="mt-1 text-amber-900/80">
                      Completa las variables en <span className="font-medium">.env.local</span>.
                    </div>
                  </div>
                )}

                {(errorParam || messageParam) && (
                  <div
                    className={[
                      "mt-6 rounded-[1.35rem] px-5 py-4 text-sm",
                      errorParam
                        ? "bg-red-50/92 text-red-900"
                        : "bg-emerald-50/92 text-emerald-900",
                    ].join(" ")}
                  >
                    {errorParam ?? messageParam}
                  </div>
                )}

                {isSupabaseConfigured ? (
                  <form action={updatePassword} className="mt-8 grid gap-4">
                    <label className="grid gap-2.5 text-sm">
                      <span className="font-medium text-[#2b2926]">Nueva contraseña</span>
                      <input
                        name="password"
                        type="password"
                        required
                        autoFocus
                        minLength={6}
                        className="h-12 rounded-xl bg-[#f3f3f1] px-4 text-[#171717] outline-none transition-colors placeholder:text-[#9b958d] focus:bg-white focus:ring-2 focus:ring-[#111111]/6"
                        placeholder="Mínimo 6 caracteres"
                      />
                    </label>
                    <label className="grid gap-2.5 text-sm">
                      <span className="font-medium text-[#2b2926]">Confirmar contraseña</span>
                      <input
                        name="confirmPassword"
                        type="password"
                        required
                        minLength={6}
                        className="h-12 rounded-xl bg-[#f3f3f1] px-4 text-[#171717] outline-none transition-colors placeholder:text-[#9b958d] focus:bg-white focus:ring-2 focus:ring-[#111111]/6"
                        placeholder="Repite la nueva contraseña"
                      />
                    </label>

                    <button
                      type="submit"
                      className="mt-1 inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#111111] px-4 text-sm font-medium text-white transition-colors hover:bg-[#1d1d1d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]/30"
                    >
                      Actualizar contraseña
                    </button>

                    <div className="pt-6 text-center">
                      <Link
                        href="/"
                        className="inline-flex items-center text-sm font-medium text-[#3b3936] transition-colors hover:text-[#111111]"
                      >
                        ← Volver al inicio de sesión
                      </Link>
                    </div>
                  </form>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
