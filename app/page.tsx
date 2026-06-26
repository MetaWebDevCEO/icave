import { createClient } from "@/utils/supabase/server";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Home({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const isSupabaseConfigured = Boolean(
    url &&
      anonKey &&
      !url.includes("__REPLACE_ME__") &&
      !anonKey.includes("__REPLACE_ME__")
  );

  async function signIn(formData: FormData) {
    "use server";

    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      redirect(
        "/?error=" +
          encodeURIComponent(
            "Faltan variables de entorno de Supabase. Configura NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local y reinicia el servidor."
          )
      );
    }

    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    if (!email || !password) {
      redirect("/?error=Email%20y%20contrase%C3%B1a%20son%20obligatorios");
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      redirect(`/?error=${encodeURIComponent(error.message)}`);
    }

    redirect("/platform");
  }

  async function signUp(formData: FormData) {
    "use server";

    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      redirect(
        "/?error=" +
          encodeURIComponent(
            "Faltan variables de entorno de Supabase. Configura NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local y reinicia el servidor."
          )
      );
    }

    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    if (!email || !password) {
      redirect("/?error=Email%20y%20contrase%C3%B1a%20son%20obligatorios");
    }

    const supabase = await createClient();
    const { error, data } = await supabase.auth.signUp({ email, password });

    if (error) {
      redirect(`/?error=${encodeURIComponent(error.message)}`);
    }

    if (data.user && !data.session) {
      redirect(
        "/?message=" +
          encodeURIComponent(
            "Registro creado. Revisa tu correo para confirmar la cuenta si está habilitado."
          )
      );
    }

    redirect("/platform");
  }

  async function signOut() {
    "use server";

    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      redirect("/");
    }

    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/");
  }

  const sp = await searchParams;
  const errorParam = typeof sp.error === "string" ? sp.error : undefined;
  const messageParam = typeof sp.message === "string" ? sp.message : undefined;

  const user = isSupabaseConfigured
    ? (await (await createClient()).auth.getUser()).data.user
    : null;

  if (isSupabaseConfigured && user && !errorParam && !messageParam) {
    redirect("/platform");
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
                  Control SOS
                </p>
                <h1 className="mt-4 max-w-sm text-5xl leading-[0.95] font-semibold lg:text-6xl">
                  Administración documentación 
                </h1>
                <p className="mt-4 max-w-sm text-sm leading-6 text-white/76">
                  Gestiona tareas, seguimiento y actividad operativa desde un
                  solo punto de entrada, con acceso seguro y flujo continuo.
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
                  <h2 className="mt-4 text-5xl leading-none font-semibold tracking-[-0.05em] text-[#151515] lg:text-[3.75rem]">
                    Promas ICAVE
                  </h2>
                  <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-[#6f6a63]">
                    Ingresa tu correo y contraseña para acceder a tu cuenta y
                    continuar dentro de la plataforma.
                  </p>
                </div>

                {!isSupabaseConfigured && (
                  <div className="mt-6 rounded-[1.35rem] bg-amber-50/90 px-5 py-4 text-sm text-amber-900">
                    <div className="font-medium">Falta configurar Supabase</div>
                    <div className="mt-1 text-amber-900/80">
                      Completa estas variables en <span className="font-medium">.env.local</span> y reinicia el servidor:
                    </div>
                    <pre className="mt-3 overflow-auto rounded-xl bg-white/90 px-4 py-3 text-xs text-amber-950">
                      {"NEXT_PUBLIC_SUPABASE_URL=\nNEXT_PUBLIC_SUPABASE_ANON_KEY="}
                    </pre>
                  </div>
                )}

                {(errorParam || messageParam) && (
                  <div
                    className={[
                      "mt-6 rounded-[1.35rem] px-5 py-4 text-sm",
                      errorParam
                        ? "bg-red-50/92 text-red-900"
                        : "bg-white/72 text-[#43403b]",
                    ].join(" ")}
                  >
                    {errorParam ?? messageParam}
                  </div>
                )}

                {isSupabaseConfigured && user ? (
                  <div className="mt-8 rounded-[1.5rem] bg-[#f7f7f5] p-6">
                    <div className="text-sm text-[#7b766f]">Sesion iniciada como</div>
                    <div className="mt-2 break-all text-lg font-medium text-[#141414]">
                      {user.email ?? user.id}
                    </div>

                    <form action={signOut} className="mt-6">
                      <button
                        type="submit"
                        className="inline-flex h-13 w-full items-center justify-center rounded-xl bg-[#111111] px-4 text-sm font-medium text-white transition-colors hover:bg-[#1d1d1d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]/30"
                      >
                        Cerrar sesion
                      </button>
                    </form>
                  </div>
                ) : isSupabaseConfigured ? (
                  <form action={signIn} className="mt-8 grid gap-4">
                    <label className="grid gap-2.5 text-sm">
                      <span className="font-medium text-[#2b2926]">Email</span>
                      <input
                        name="email"
                        type="email"
                        required
                        className="h-12 rounded-xl bg-[#f3f3f1] px-4 text-[#171717] outline-none transition-colors placeholder:text-[#9b958d] focus:bg-white focus:ring-2 focus:ring-[#111111]/6"
                        placeholder="Ingresa tu email"
                      />
                    </label>
                    <label className="grid gap-2.5 text-sm">
                      <span className="font-medium text-[#2b2926]">Contraseña</span>
                      <input
                        name="password"
                        type="password"
                        required
                        className="h-12 rounded-xl bg-[#f3f3f1] px-4 text-[#171717] outline-none transition-colors placeholder:text-[#9b958d] focus:bg-white focus:ring-2 focus:ring-[#111111]/6"
                        placeholder="Ingresa tu contraseña"
                      />
                    </label>
                    <div className="flex items-center justify-between gap-4 text-sm text-[#6f6a63]">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          name="remember"
                          className="h-4 w-4 rounded-full bg-[#ece8e1] accent-[#111111]"
                        />
                        <span>Recordarme</span>
                      </label>
                      <span className="text-sm font-medium text-[#3b3936]">
                        Olvide mi contraseña
                      </span>
                    </div>
                    <button
                      type="submit"
                      className="mt-1 inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#111111] px-4 text-sm font-medium text-white transition-colors hover:bg-[#1d1d1d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]/30"
                    >
                      Entrar
                    </button>
                    <div className="pt-8 text-center text-xs leading-6 text-[#7b766f]">
                      <a
                        href="https://metawebdevsolutions.com.mx"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
                      >
                        <span>Plataforma desarrollada por</span>
                        <Image
                          src="/metaweb.svg"
                          alt="Logo de MetaWeb"
                          width={52}
                          height={16}
                          className="h-auto w-10 opacity-80"
                        />
                        <span>MetaWeb Dev Solutions</span>
                      </a>
                      <p className="mt-2">
                        <Link
                          href="/politicas"
                          className="transition-colors hover:text-[#3b3936]"
                        >
                          Politicas
                        </Link>
                        <span className="px-2 text-[#b0aaa2]">-</span>
                        <Link
                          href="/privacidad"
                          className="transition-colors hover:text-[#3b3936]"
                        >
                          Privacidad
                        </Link>
                      </p>
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
