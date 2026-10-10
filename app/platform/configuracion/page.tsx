import { PlatformShell } from "@/app/platform/platform-shell";
import type { SidebarSection } from "@/app/platform/components/sidebar";
import { AvatarUploadForm } from "@/app/platform/configuracion/avatar-upload-form";
import { ProfileFormClient } from "@/app/platform/configuracion/profile-form";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import {
  createClient as createSupabaseAdminClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import {
  buildSections,
  getRoleFromUserRolesTable,
  type UserRole,
  resolveRoleForUser,
} from "@/lib/platform-roles";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const AVATAR_BUCKET = "avatars";
const MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type ServerActionResult = {
  ok: boolean;
  url?: string | null;
  error?: string | null;
};

function isNextRedirectError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { digest?: unknown; message?: unknown };
  if (typeof e.digest === "string" && e.digest.startsWith("NEXT_REDIRECT")) return true;
  if (typeof e.message === "string" && e.message.includes("NEXT_REDIRECT")) return true;
  return false;
}

function redirectOrError(path: string, query?: { error?: string; message?: string }): ServerActionResult {
  const url = new URL(path, "http://localhost");
  if (query?.error) url.searchParams.set("error", query.error);
  if (query?.message) url.searchParams.set("message", query.message);
  return { ok: !query?.error, url: url.pathname + url.search };
}

function getSearchParam(
  sp: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = sp[key];
  return typeof value === "string" ? value : undefined;
}

function deriveDisplayName(email: string | undefined, metadata: Record<string, unknown>) {
  const metadataName =
    typeof metadata.full_name === "string"
      ? metadata.full_name
      : typeof metadata.name === "string"
        ? metadata.name
        : typeof metadata.display_name === "string"
          ? metadata.display_name
          : "";

  if (metadataName.trim()) return metadataName.trim();
  if (!email) return "Usuario";

  const localPart = email.split("@")[0] ?? "usuario";
  return localPart
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getMetadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" ? value.trim() : "";
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Sin registro";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin registro";

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function normalizeHandle(value: string) {
  return value.replace(/^@+/, "").replace(/\s+/g, "").trim().slice(0, 80);
}

function getAvatarExtension(contentType: string) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

async function removeStorageObject(
  client: SupabaseClient,
  bucket: string,
  path: string
) {
  try {
    const { error } = await client.storage.from(bucket).remove([path]);
    return error;
  } catch {
    return null;
  }
}

async function resolveAvatarUrl(
  supabase: SupabaseClient,
  admin: SupabaseClient | null,
  bucket: string,
  path: string
) {
  try {
    const signedA = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 10);
    if (signedA.data?.signedUrl && !signedA.error) return signedA.data.signedUrl;
  } catch {
    /* ignore */
  }

  if (!admin) return null;

  try {
    const signedB = await admin.storage.from(bucket).createSignedUrl(path, 60 * 10);
    if (signedB.data?.signedUrl && !signedB.error) return signedB.data.signedUrl;
  } catch {
    /* ignore */
  }

  return null;
}

async function uploadAvatarForUser(
  supabase: SupabaseClient,
  admin: SupabaseClient | null,
  user: { id: string; user_metadata?: unknown },
  avatarFile: File
): Promise<ServerActionResult> {
  if (!ALLOWED_AVATAR_TYPES.has(avatarFile.type)) {
    return redirectOrError("/platform/configuracion", {
      error: "El avatar debe ser JPG, PNG o WEBP.",
    });
  }

  if (avatarFile.size > MAX_AVATAR_SIZE_BYTES) {
    return redirectOrError("/platform/configuracion", {
      error: "El avatar no puede superar 2 MB.",
    });
  }

  const metadata =
    user.user_metadata && typeof user.user_metadata === "object"
      ? (user.user_metadata as Record<string, unknown>)
      : {};
  const previousPath =
    typeof metadata.avatar_path === "string" ? metadata.avatar_path.trim() : "";
  const extension = getAvatarExtension(avatarFile.type);
  const objectPath = `${user.id}/avatar_${Date.now()}.${extension}`;

  let uploadError: Error | null = null;
  try {
    const uploadA = await supabase.storage.from(AVATAR_BUCKET).upload(objectPath, avatarFile, {
      contentType: avatarFile.type,
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadA.error) uploadError = uploadA.error;
  } catch (e) {
    uploadError = e instanceof Error ? e : new Error(String(e));
  }

  if (uploadError && admin) {
    try {
      const uploadB = await admin.storage.from(AVATAR_BUCKET).upload(objectPath, avatarFile, {
        contentType: avatarFile.type,
        cacheControl: "3600",
        upsert: false,
      });
      uploadError = uploadB.error ?? null;
    } catch (e) {
      uploadError = e instanceof Error ? e : new Error(String(e));
    }
  }

  if (uploadError) {
    return redirectOrError("/platform/configuracion", { error: uploadError.message });
  }

  let updateError: Error | null = null;
  try {
    const { error } = await supabase.auth.updateUser({
      data: {
        ...metadata,
        avatar_bucket: AVATAR_BUCKET,
        avatar_path: objectPath,
        avatar_updated_at: new Date().toISOString(),
      },
    });
    if (error) updateError = error;
  } catch (e) {
    if (isNextRedirectError(e)) {
      // updateUser internamente no hace redirect, pero protegemos
    }
    updateError = e instanceof Error ? e : new Error(String(e));
  }

  if (updateError) {
    const cleaner = admin ?? supabase;
    await removeStorageObject(cleaner, AVATAR_BUCKET, objectPath);
    return redirectOrError("/platform/configuracion", { error: updateError.message });
  }

  if (previousPath && previousPath !== objectPath) {
    const cleaner = admin ?? supabase;
    await removeStorageObject(cleaner, AVATAR_BUCKET, previousPath);
  }

  return redirectOrError("/platform/configuracion", {
    message: "Avatar actualizado correctamente.",
  });
}

export default async function ConfiguracionPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
    redirect("/?error=" + encodeURIComponent("Configura Supabase primero (env vars)."));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin =
    serviceKey && !serviceKey.includes("__REPLACE_ME__")
      ? createSupabaseAdminClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;

  if (!user) {
    redirect("/");
  }

  let role: UserRole;
  try {
    role = await resolveRoleForUser(supabase, user.id, { email: user.email ?? null });
  } catch (e) {
    // resolveRoleForUser ya tiene fallback a "usuario" en platform-roles.
    // Si algo sale mal excepcionalmente, usamos "usuario" (Supervisor) = mínimo privilegio.
    console.warn("[configuracion] resolveRoleForUser falló. Fallback a 'usuario'.", e);
    role = "usuario";
  }

  async function updateProfile(formData: FormData): Promise<ServerActionResult> {
    "use server";

    const urlEnv = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonEnv = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!urlEnv || !anonEnv || urlEnv.includes("__REPLACE_ME__") || anonEnv.includes("__REPLACE_ME__")) {
      return redirectOrError("/", { error: "Configura Supabase primero (env vars)." });
    }

    const supabaseSrv = await createClient();
    const res = await supabaseSrv.auth.getUser();
    const userSrv = res.data?.user;

    if (!userSrv) {
      return redirectOrError("/");
    }

    const fullName = String(formData.get("full_name") ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    const username = normalizeHandle(String(formData.get("username") ?? ""));
    const headline = String(formData.get("headline") ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    const bio = String(formData.get("bio") ?? "").trim().slice(0, 300);
    const location = String(formData.get("location") ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);

    if (!fullName) {
      return redirectOrError("/platform/configuracion", {
        error: "Escribe un nombre visible para tu perfil.",
      });
    }

    try {
      const { error } = await supabaseSrv.auth.updateUser({
        data: {
          ...(userSrv.user_metadata ?? {}),
          full_name: fullName,
          display_name: fullName,
          username,
          headline,
          bio,
          location,
        },
      });

      if (error) {
        return redirectOrError("/platform/configuracion", { error: error.message });
      }
    } catch (e) {
      if (isNextRedirectError(e)) {
        return redirectOrError("/platform/configuracion", {
          message: "Perfil actualizado correctamente.",
        });
      }
      const msg = e instanceof Error ? e.message : "Error desconocido";
      return redirectOrError("/platform/configuracion", { error: msg });
    }

    return redirectOrError("/platform/configuracion", {
      message: "Perfil actualizado correctamente.",
    });
  }

  async function uploadAvatar(formData: FormData): Promise<ServerActionResult> {
    "use server";

    const urlEnv = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonEnv = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceEnv = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!urlEnv || !anonEnv || urlEnv.includes("__REPLACE_ME__") || anonEnv.includes("__REPLACE_ME__")) {
      return redirectOrError("/", { error: "Configura Supabase primero (env vars)." });
    }

    const supabaseSrv = await createClient();
    const res = await supabaseSrv.auth.getUser();
    const userSrv = res.data?.user;
    const adminSrv =
      serviceEnv && !serviceEnv.includes("__REPLACE_ME__")
        ? createSupabaseAdminClient(urlEnv, serviceEnv, {
            auth: { persistSession: false, autoRefreshToken: false },
          })
        : null;

    if (!userSrv) {
      return redirectOrError("/");
    }

    const avatarFile = formData.get("avatar");
    if (!(avatarFile instanceof File) || avatarFile.size === 0) {
      return redirectOrError("/platform/configuracion", {
        error: "Selecciona una imagen para actualizar el avatar.",
      });
    }

    return uploadAvatarForUser(supabaseSrv, adminSrv, userSrv, avatarFile);
  }

  const sections = buildSections(role);
  const sp = await searchParams;
  const errorParam = getSearchParam(sp, "error");
  const messageParam = getSearchParam(sp, "message");
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const displayName = deriveDisplayName(user.email ?? undefined, metadata);
  const roleLabel = role === "revisor" ? "Revisor" : "Supervisor";
  const emailConfirmed = Boolean(user.email_confirmed_at);
  const username =
    getMetadataString(metadata, "username") ||
    (user.email?.split("@")[0] ?? "").replace(/[^\w.-]+/g, "");
  const headline =
    getMetadataString(metadata, "headline") ||
    (role === "revisor" ? "Coordinacion y revision operativa" : "Seguimiento operativo");
  const bio =
    getMetadataString(metadata, "bio") ||
    "Administra aqui tu informacion publica dentro de la plataforma para que tu perfil se vea claro, profesional y consistente.";
  const location = getMetadataString(metadata, "location") || "Veracruz, MX";
  const avatarBucket = getMetadataString(metadata, "avatar_bucket");
  const avatarPath = getMetadataString(metadata, "avatar_path");
  const avatarFallback =
    displayName
      .split(/[\s@._-]+/g)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "U";
  const avatarUrl =
    avatarBucket && avatarPath
      ? await resolveAvatarUrl(supabase, admin, avatarBucket, avatarPath)
      : null;

  return (
    <PlatformShell
      sections={sections}
      currentUserId={user.id}
      currentUserEmail={user.email ?? undefined}
    >
      <div className="mx-auto max-w-6xl">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Editar perfil
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Actualiza la informacion de tu perfil. Los cambios se reflejan en la vista previa.
          </p>
        </div>

        {errorParam && (
          <div className="mt-6 border-l-2 border-red-500 pl-4 text-sm text-red-700 dark:text-red-300">
            {errorParam}
          </div>
        )}

        {messageParam && (
          <div className="mt-6 border-l-2 border-emerald-500 pl-4 text-sm text-emerald-700 dark:text-emerald-300">
            {messageParam}
          </div>
        )}

        <div className="mt-10 grid gap-12 xl:grid-cols-[1.45fr_0.95fr]">
          <div className="grid gap-8">
            <section className="border-b border-zinc-200 pb-10 dark:border-zinc-800">
              <div>
                <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
                  Informacion basica
                </h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  Informacion visible dentro de tu perfil
                </p>
              </div>

              <AvatarUploadForm
                action={uploadAvatar}
                avatarUrl={avatarUrl}
                displayName={displayName}
                avatarFallback={avatarFallback}
              />
            </section>

            <ProfileFormClient action={updateProfile} defaultValues={{
              full_name: displayName,
              username,
              headline,
              bio,
              location,
            }} />
          </div>

          <aside className="space-y-10 xl:sticky xl:top-28 xl:self-start xl:border-l xl:border-zinc-200 xl:pl-10 dark:xl:border-zinc-800">
            <section>
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                  Vista previa
                </div>
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                  Vista publica
                </div>
              </div>

              <div className="mt-6 px-1 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-[radial-gradient(circle_at_30%_30%,#D9E7FF_0%,#82A6E8_42%,#003373_100%)] text-lg font-semibold text-white shadow-sm ring-4 ring-[#EAF0FB] dark:ring-zinc-900">
                  <AvatarImage
                    src={avatarUrl}
                    alt={`Vista previa del avatar de ${displayName}`}
                    fallback={avatarFallback}
                  />
                </div>
                <div className="mt-5 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                  {displayName}
                </div>
                <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  @{username || "usuario"}
                </div>
                <div className="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {headline}
                </div>
                <div className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
                  {location}
                </div>

                <div className="mt-6 border-t border-zinc-200 pt-5 text-sm leading-6 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                  {bio}
                </div>
              </div>

              <div className="mt-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
                Asi se muestra tu perfil dentro de la plataforma
              </div>
            </section>

            <section className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                Estado de la cuenta
              </div>
              <dl className="mt-4 grid gap-4">
                <div>
                  <dt className="text-sm text-zinc-500 dark:text-zinc-400">Correo confirmado</dt>
                  <dd className="mt-1 text-base font-medium text-zinc-950 dark:text-zinc-50">
                    {emailConfirmed ? "Confirmado" : "Pendiente"}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-zinc-500 dark:text-zinc-400">Registro en plataforma</dt>
                  <dd className="mt-1 text-base font-medium text-zinc-950 dark:text-zinc-50">
                    {formatDateTime(user.created_at)}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-zinc-500 dark:text-zinc-400">Ultimo acceso</dt>
                  <dd className="mt-1 text-base font-medium text-zinc-950 dark:text-zinc-50">
                    {formatDateTime(user.last_sign_in_at)}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-zinc-500 dark:text-zinc-400">Rol</dt>
                  <dd className="mt-1 text-base font-medium text-zinc-950 dark:text-zinc-50">
                    {roleLabel}
                  </dd>
                </div>
              </dl>
            </section>
          </aside>
        </div>
      </div>
    </PlatformShell>
  );
}

function AvatarImage({
  src,
  alt,
  fallback,
}: {
  src: string | null;
  alt: string;
  fallback: string;
}) {
  // "use client" no permitido aqui en RSC, pero podemos usar next/image o un <img> con atributos
  // Para mantener la renderizacion sencilla y consistente con el Avatar shadcn,
  // agregamos los atributos de CORS. El onError es cliente, asi que retornamos el raw img.
  // En entorno RSC sin hidratacion, onerror no corre en el server pero si en el cliente.
  // Para robustez, el componente AvatarUploadForm ya usa un approach client-side.
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="h-full w-full object-cover"
      referrerPolicy="no-referrer"
      crossOrigin="anonymous"
      loading="lazy"
      decoding="async"
    />
  ) : (
    <>{fallback}</>
  );
}


