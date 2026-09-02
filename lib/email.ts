import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;
const defaultFrom = process.env.RESEND_FROM_EMAIL ?? "Promas iCave <soporte@promasicave.com>";
const defaultFromName = process.env.RESEND_FROM_NAME ?? "Promas iCave";
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://promasicave.com";

export const resend = apiKey ? new Resend(apiKey) : null;

export function isResendConfigured(): boolean {
  return Boolean(resend);
}

export function getFromAddress(): string {
  return defaultFrom;
}

export type SendEmailParams = {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  tags?: { name: string; value: string }[];
};

export async function sendEmail(params: SendEmailParams) {
  if (!resend) {
    return {
      id: null,
      error: "RESEND_API_KEY no está configurada en el entorno.",
    };
  }

  const { to, subject, html, text, replyTo, cc, bcc, tags } = params;

  const payload: Record<string, unknown> = {
    from: defaultFrom,
    to,
    subject,
    reply_to: replyTo ?? defaultFrom,
  };

  if (html) payload.html = html;
  if (text) payload.text = text;
  if (cc) payload.cc = cc;
  if (bcc) payload.bcc = bcc;
  if (tags && tags.length > 0) payload.headers = { tags: JSON.stringify(tags) };

  try {
    const response = await (resend as unknown as { emails: { send: (p: Record<string, unknown>) => Promise<{ data: { id: string } | null; error: { message: string } | null }> } }).emails.send(payload);
    return {
      id: response.data?.id ?? null,
      error: response.error?.message ?? null,
    };
  } catch (err) {
    return {
      id: null,
      error: err instanceof Error ? err.message : "Error desconocido al enviar el correo.",
    };
  }
}

export function buildBrandedHtmlEmail(options: {
  title: string;
  subtitle?: string;
  body: string[];
  primaryCta?: { label: string; href: string };
  footer?: string;
}): string {
  const { title, subtitle, body, primaryCta, footer } = options;

  const ctaBlock = primaryCta
    ? `<tr><td align="left" style="padding: 18px 28px 28px 28px;"><table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:separate;"><tr><td style="border-radius:10px;background:#18181b;"><a href="${primaryCta.href}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:10px;" target="_blank">${primaryCta.label}</a></td></tr></table></td></tr>`
    : "";

  const bodyRows = body
    .map(
      (line) =>
        `<tr><td align="left" style="padding:0 28px 14px 28px;font-size:14px;line-height:20px;color:#3f3f46;">${line}</td></tr>`
    )
    .join("");

  return `<!doctype html><html xmlns="http://www.w3.org/1999/xhtml" lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1.0"/><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/><title>${title}</title></head><body style="background-color:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;margin:0;padding:0;"><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#fafafa;"><tr><td align="center" style="padding:30px 0 24px 0;"><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="640" style="max-width:640px;border-radius:16px;overflow:hidden;background:#ffffff;border:1px solid #e4e4e7;"><tr><td style="padding:28px 28px 8px 28px;"><h1 style="margin:0;font-size:20px;font-weight:700;line-height:28px;color:#09090b;">${title}</h1>${subtitle ? `<p style="margin:6px 0 0 0;font-size:14px;line-height:20px;color:#52525b;">${subtitle}</p>` : ""}</td></tr>${bodyRows}${ctaBlock}<tr><td style="padding:0 28px 28px 28px;font-size:12px;line-height:18px;color:#a1a1aa;">${footer ?? `© ${new Date().getFullYear()} Promas iCave · ${appUrl}`}</td></tr></table></td></tr></table></body></html>`;
}

export function buildPlainEmail(body: string[]): string {
  return body.join("\n\n");
}
