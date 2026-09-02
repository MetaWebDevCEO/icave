import { PlatformShell } from "@/app/platform/platform-shell";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { buildSections, resolveRoleForUser } from "@/lib/platform-roles";
import {
  buildBrandedHtmlEmail,
  buildPlainEmail,
  isResendConfigured,
  sendEmail,
  getFromAddress,
} from "@/lib/email";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function getSearchParam(
  sp: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = sp[key];
  return typeof value === "string" ? value : undefined;
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value.trim());
}

export const dynamic = "force-dynamic";

export default async function CorreosPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const role = await resolveRoleForUser(supabase, user.id);
  const sections = buildSections(role);

  const sp = await searchParams;
  const errorParam = getSearchParam(sp, "error");
  const messageParam = getSearchParam(sp, "message");

  const configured = isResendConfigured();
  const fromAddress = getFromAddress();

  let userEmails: string[] = [];
  try {
    const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (svcKey && url && !svcKey.includes("__REPLACE_ME__") && !url.includes("__REPLACE_ME__")) {
      const { createClient: createAdmin } = await import("@supabase/supabase-js");
      const admin = createAdmin(url, svcKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const listed = await admin.from("user_roles").select("user_id").limit(1000);
      const ids = new Set(
        (listed.data ?? [])
          .map((r) => (r as { user_id?: string }).user_id)
          .filter((v): v is string => Boolean(v))
      );
      if (ids.size > 0) {
        const usersRes = await admin.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });
        const emails = (usersRes.data?.users ?? [])
          .map((u) => u.email)
          .filter((v): v is string => Boolean(v) && isEmail(v));
        userEmails = Array.from(new Set(emails)).sort();
      }
    }
  } catch {
    userEmails = [];
  }

  async function sendComposed(formData: FormData) {
    "use server";

    const check = await createClient();
    const {
      data: { user: checkUser },
    } = await check.auth.getUser();
    if (!checkUser) redirect("/platform/correos");

    const toRaw = String(formData.get("to") ?? "").trim();
    const subject = String(formData.get("subject") ?? "").trim();
    const body = String(formData.get("body") ?? "").trim();
    const replyTo = String(formData.get("reply_to") ?? "").trim();

    if (!toRaw) {
      redirect(
        "/platform/correos?error=" + encodeURIComponent("Elige al menos un destinatario.")
      );
    }
    if (!subject || !body) {
      redirect(
        "/platform/correos?error=" +
          encodeURIComponent("Asunto y mensaje son obligatorios.")
      );
    }

    const recipients = toRaw
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!recipients.every(isEmail)) {
      redirect(
        "/platform/correos?error=" + encodeURIComponent("Hay correos inválidos en el destinatario.")
      );
    }

    const lines = body.split(/\r?\n/).filter(Boolean);

    const result = await sendEmail({
      to: recipients,
      subject,
      html: buildBrandedHtmlEmail({
        title: subject,
        subtitle: replyTo ? `Enviado por ${replyTo}` : undefined,
        body: lines,
      }),
      text: buildPlainEmail(lines),
      replyTo: replyTo ? replyTo : checkUser.email ?? undefined,
    });

    if (result.error) {
      redirect(
        "/platform/correos?error=" +
          encodeURIComponent(`No se pudo enviar: ${result.error}`)
      );
    }

    redirect(
      "/platform/correos?message=" +
        encodeURIComponent(`Correo enviado a ${recipients.length} destinatario(s).`)
    );
  }

  return (
    <PlatformShell
      sections={sections}
      currentUserId={user.id}
      currentUserEmail={user.email ?? undefined}
    >
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              Correos
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Envía correos desde la plataforma con Remitente oficial.
            </p>
          </div>
          <div
            className={[
              "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset",
              configured
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900"
                : "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900",
            ].join(" ")}
          >
            {configured ? "Resend conectado" : "Resend sin configurar"}
          </div>
        </div>

        {(errorParam || messageParam) && (
          <div
            className={[
              "mt-4 rounded-lg border p-4 text-sm",
              errorParam
                ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100"
                : "border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-100",
            ].join(" ")}
          >
            {errorParam ?? messageParam}
          </div>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <div className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                Redactar correo
              </div>
              <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Remitente: {fromAddress}
              </div>
            </div>
            <form action={sendComposed} className="grid gap-4 p-5">
              <label className="grid gap-1 text-sm">
                <span className="text-zinc-700 dark:text-zinc-300">
                  Para
                </span>
                <input
                  name="to"
                  required
                  placeholder="correo@dominio.com (separa varios con coma)"
                  className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-50"
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-zinc-700 dark:text-zinc-300">
                  Responder a (opcional)
                </span>
                <input
                  name="reply_to"
                  type="email"
                  defaultValue={user.email ?? ""}
                  className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-50"
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-zinc-700 dark:text-zinc-300">Asunto</span>
                <input
                  name="subject"
                  required
                  placeholder="Ej. Nueva asignación disponible"
                  className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-50"
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-zinc-700 dark:text-zinc-300">Mensaje</span>
                <textarea
                  name="body"
                  required
                  rows={8}
                  placeholder="Escribe tu mensaje aquí. Puedes usar saltos de línea."
                  className="resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-50"
                />
              </label>

              <button
                type="submit"
                disabled={!configured}
                className={[
                  "inline-flex h-10 items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200",
                  !configured
                    ? "cursor-not-allowed opacity-50 hover:bg-zinc-900 dark:hover:bg-zinc-50"
                    : "",
                ].join(" ")}
              >
                Enviar correo
              </button>
            </form>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                Destinatarios rápidos
              </div>
              {userEmails.length === 0 ? (
                <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  No se pudo listar usuarios desde Supabase Auth. Copia y pega
                  correos manualmente en Para.
                </div>
              ) : (
                <div className="mt-3 max-h-[320px] space-y-1 overflow-auto pr-1">
                  {userEmails.map((email) => (
                    <button
                      key={email}
                      type="button"
                      onClick={() => {
                        if (typeof window === "undefined") return;
                        const el = document.querySelector<HTMLInputElement>('input[name="to"]');
                        if (!el) return;
                        const current = el.value.trim();
                        const existing = current
                          ? current.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
                          : [];
                        if (!existing.includes(email)) existing.push(email);
                        el.value = existing.join(", ");
                        const ev = new Event("input", { bubbles: true });
                        el.dispatchEvent(ev);
                      }}
                      className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-left text-xs text-zinc-800 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:text-zinc-200 dark:hover:bg-zinc-900"
                    >
                      <span className="truncate">{email}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                Estado de envío
              </div>
              <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                {configured
                  ? "Resend está listo para enviar desde soporte@promasicave.com. Verifica que tu dominio esté verificado en Resend para evitar SPAM."
                  : "Agrega RESEND_API_KEY en tus variables de entorno para habilitar el envío."}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PlatformShell>
  );
}
