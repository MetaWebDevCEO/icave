import { createClient } from "@/utils/supabase/server";
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
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-md flex-col gap-6 px-6 py-20">

        {!isSupabaseConfigured && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
            <div className="font-medium">Falta configurar Supabase</div>
            <div className="mt-1">
              Completa estas variables en <span className="font-medium">.env.local</span>{" "}
              y reinicia el servidor:
            </div>
            <pre className="mt-2 overflow-auto rounded-md bg-white/70 p-3 text-xs text-amber-950 dark:bg-black/30 dark:text-amber-100">
              {"NEXT_PUBLIC_SUPABASE_URL=\nNEXT_PUBLIC_SUPABASE_ANON_KEY="}
            </pre>
          </div>
        )}

        {(errorParam || messageParam) && (
          <div
            className={[
              "rounded-lg border p-4 text-sm",
              errorParam
                ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100"
                : "border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-100",
            ].join(" ")}
          >
            {errorParam ?? messageParam}
          </div>
        )}

        {isSupabaseConfigured && user ? (
          <div className="rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              Sesión iniciada como
            </div>
            <div className="mt-1 font-medium text-zinc-950 dark:text-zinc-50">
              {user.email ?? user.id}
            </div>

            <form action={signOut} className="mt-6">
              <button
                type="submit"
                className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Cerrar sesión
              </button>
            </form>
          </div>
        ) : isSupabaseConfigured ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-black">
            <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              Login
            </h2>
            <form action={signIn} className="mt-4 grid gap-3">
              <label className="grid gap-1 text-sm">
                <span className="text-zinc-700 dark:text-zinc-300">Email</span>
                <input
                  name="email"
                  type="email"
                  required
                  className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-zinc-950 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
                  placeholder="tu@email.com"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-zinc-700 dark:text-zinc-300">
                  Contraseña
                </span>
                <input
                  name="password"
                  type="password"
                  required
                  className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-zinc-950 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
                />
              </label>
              <button
                type="submit"
                className="mt-2 inline-flex h-10 items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Entrar
              </button>
            </form>
          </div>
        ) : null}
      </main>
    </div>
  );
}
