import { PlatformShell } from "@/app/platform/platform-shell";
import type { SidebarSection } from "@/app/platform/components/sidebar";
import { AvatarUploadForm } from "@/app/platform/configuracion/avatar-upload-form";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import {
  createClient as createSupabaseAdminClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

type UserRole = "revisor" | "usuario";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const AVATAR_BUCKET = "avatars";
const MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function isUserRole(value: unknown): value is UserRole {
  return value === "revisor" || value === "usuario";
}

function normalizeRole(value: unknown): UserRole | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return isUserRole(normalized) ? normalized : null;
}

function normalizeRoleCode(value: unknown): UserRole | null {
  if (typeof value === "number") {
    if (value === 1) return "revisor";
    if (value === 2) return "usuario";
    return null;
  }

  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();

  if (isUserRole(normalized)) return normalized;
  if (normalized === "reviewer" || normalized === "rev" || normalized === "r") {
    return "revisor";
  }
  if (normalized === "admin" || normalized === "administrador") {
    return "usuario";
  }
  if (normalized === "sup" || normalized === "s") {
    return "usuario";
  }
  if (normalized.includes("usuario")) return "usuario";
  if (normalized.includes("super")) return "usuario";
  if (normalized.includes("revi")) return "revisor";

  return null;
}

async function getRoleFromUserRolesTable(
  supabase: SupabaseClient,
  userId: string
): Promise<UserRole> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("No existe un registro en user_roles para este usuario");
  }

  const record = data as Record<string, unknown>;
  const role =
    normalizeRole(record.role) ??
    normalizeRole(record.rol) ??
    normalizeRole(record.user_role) ??
    normalizeRole(record.tipo) ??
    normalizeRole(record.type) ??
    normalizeRoleCode(record.role_code);

  if (!role) {
    throw new Error("No se encontró una columna de rol válida en user_roles.");
  }

  return role;
}

function buildSections(role: UserRole): SidebarSection[] {
  const platformTitle =
    role === "usuario" ? "Plataforma (Supervisor)" : "Plataforma (Revisor)";

  return role === "usuario"
    ? [
        {
          title: platformTitle,
          items: [
            { title: "Mi Rendimiento", href: "/platform" },
            { title: "Status", href: "/platform/status" },
            { title: "Bandeja de Entrada", href: "/platform/bandeja" },
            { title: "Task", href: "/platform/task" },
          ],
        },
        {
          title: "Herramientas",
          items: [
            { title: "Chat Directo", href: "/platform/chat" },
            { title: "Correos", href: "/platform/correos" },
            { title: "Documentos", href: "/platform/documentos" },
            { title: "Planificador", href: "/platform/planificador" },
          ],
        },
        {
          title: "Configuracion",
          items: [
            { title: "Notificaciones", href: "/platform/settings/notificaciones" }
          ],
        },
      ]
    : [
        {
          title: platformTitle,
          items: [
            { title: "Dashboard", href: "/platform" },
            { title: "Asignacion", href: "/platform/revisor/asignacion" },
            { title: "Supervisores", href: "/platform/supervisores" },
            { title: "Task", href: "/platform/task" },
          ],
        },
        {
          title: "Herramientas",
          items: [
            { title: "Chat Directo", href: "/platform/chat" },
            { title: "Correos", href: "/platform/correos" },
            { title: "Documentos", href: "/platform/documentos" },
            { title: "Planificador", href: "/platform/planificador" },
          ],
        },
        {
          title: "Configuracion",
          items: [
            { title: "Roles", href: "/platform/settings/roles" },
            { title: "Usuarios", href: "/platform/settings/usuarios" },
            { title: "Configuracion", href: "/platform/configuracion" },
          ],
        },
      ];
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
  const { error } = await client.storage.from(bucket).remove([path]);
  return error;
}

async function resolveAvatarUrl(
  supabase: SupabaseClient,
  admin: SupabaseClient | null,
  bucket: string,
  path: string
) {
  const signedA = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 10);
  if (signedA.data?.signedUrl && !signedA.error) return signedA.data.signedUrl;

  if (!admin) return null;

  const signedB = await admin.storage.from(bucket).createSignedUrl(path, 60 * 10);
  if (signedB.data?.signedUrl && !signedB.error) return signedB.data.signedUrl;

  return null;
}

async function uploadAvatarForUser(
  supabase: SupabaseClient,
  admin: SupabaseClient | null,
  user: { id: string; user_metadata?: unknown },
  avatarFile: File
) {
  if (!ALLOWED_AVATAR_TYPES.has(avatarFile.type)) {
    redirect(
      "/platform/configuracion?error=" +
        encodeURIComponent("El avatar debe ser JPG, PNG o WEBP.")
    );
  }

  if (avatarFile.size > MAX_AVATAR_SIZE_BYTES) {
    redirect(
      "/platform/configuracion?error=" +
        encodeURIComponent("El avatar no puede superar 2 MB.")
    );
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
  const uploadA = await supabase.storage.from(AVATAR_BUCKET).upload(objectPath, avatarFile, {
    contentType: avatarFile.type,
    cacheControl: "3600",
    upsert: false,
  });

  if (uploadA.error) {
    uploadError = uploadA.error;
  }

  if (uploadError && admin) {
    const uploadB = await admin.storage.from(AVATAR_BUCKET).upload(objectPath, avatarFile, {
      contentType: avatarFile.type,
      cacheControl: "3600",
      upsert: false,
    });
    uploadError = uploadB.error ?? null;
  }

  if (uploadError) {
    redirect("/platform/configuracion?error=" + encodeURIComponent(uploadError.message));
  }

  const { error: updateError } = await supabase.auth.updateUser({
    data: {
      ...metadata,
      avatar_bucket: AVATAR_BUCKET,
      avatar_path: objectPath,
      avatar_updated_at: new Date().toISOString(),
    },
  });

  if (updateError) {
    if (admin) {
      await removeStorageObject(admin, AVATAR_BUCKET, objectPath);
    } else {
      await removeStorageObject(supabase, AVATAR_BUCKET, objectPath);
    }
    redirect("/platform/configuracion?error=" + encodeURIComponent(updateError.message));
  }

  if (previousPath && previousPath !== objectPath) {
    if (admin) {
      await removeStorageObject(admin, AVATAR_BUCKET, previousPath);
    } else {
      await removeStorageObject(supabase, AVATAR_BUCKET, previousPath);
    }
  }
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
    role = await getRoleFromUserRolesTable(supabase, user.id);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error desconocido";
    redirect("/?error=" + encodeURIComponent("Rol: " + message));
  }

  async function updateProfile(formData: FormData) {
    "use server";

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
      redirect("/?error=" + encodeURIComponent("Configura Supabase primero (env vars)."));
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      redirect("/");
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
      redirect(
        "/platform/configuracion?error=" +
          encodeURIComponent("Escribe un nombre visible para tu perfil.")
      );
    }

    const { error } = await supabase.auth.updateUser({
      data: {
        ...user.user_metadata,
        full_name: fullName,
        display_name: fullName,
        username,
        headline,
        bio,
        location,
      },
    });

    if (error) {
      redirect("/platform/configuracion?error=" + encodeURIComponent(error.message));
    }

    redirect(
      "/platform/configuracion?message=" +
        encodeURIComponent("Perfil actualizado correctamente.")
    );
  }

  async function uploadAvatar(formData: FormData) {
    "use server";

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

    const avatarFile = formData.get("avatar");
    if (!(avatarFile instanceof File) || avatarFile.size === 0) {
      redirect(
        "/platform/configuracion?error=" +
          encodeURIComponent("Selecciona una imagen para actualizar el avatar.")
      );
    }

    await uploadAvatarForUser(supabase, admin, user, avatarFile);

    redirect(
      "/platform/configuracion?message=" +
        encodeURIComponent("Avatar actualizado correctamente.")
    );
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

            <form action={updateProfile} className="grid gap-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Nombre
                  </span>
                  <input
                    type="text"
                    name="full_name"
                    defaultValue={displayName}
                    className="h-11 border-0 border-b border-zinc-300 bg-transparent px-0 text-sm text-zinc-950 outline-none transition-colors focus:border-[#003373] focus:ring-0 dark:border-zinc-700 dark:text-zinc-50"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Usuario
                  </span>
                  <input
                    type="text"
                    name="username"
                    defaultValue={username}
                    className="h-11 border-0 border-b border-zinc-300 bg-transparent px-0 text-sm text-zinc-950 outline-none transition-colors focus:border-[#003373] focus:ring-0 dark:border-zinc-700 dark:text-zinc-50"
                  />
                </label>
              </div>

              <div className="grid gap-5">
                <label className="grid gap-2">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Cargo / Titulo
                  </span>
                  <input
                    type="text"
                    name="headline"
                    defaultValue={headline}
                    className="h-11 border-0 border-b border-zinc-300 bg-transparent px-0 text-sm text-zinc-950 outline-none transition-colors focus:border-[#003373] focus:ring-0 dark:border-zinc-700 dark:text-zinc-50"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Biografia
                  </span>
                  <textarea
                    name="bio"
                    defaultValue={bio}
                    rows={4}
                    className="min-h-[110px] border-0 border-b border-zinc-300 bg-transparent px-0 py-2 text-sm text-zinc-950 outline-none transition-colors focus:border-[#003373] focus:ring-0 dark:border-zinc-700 dark:text-zinc-50"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Ubicacion
                  </span>
                  <input
                    type="text"
                    name="location"
                    defaultValue={location}
                    className="h-11 border-0 border-b border-zinc-300 bg-transparent px-0 text-sm text-zinc-950 outline-none transition-colors focus:border-[#003373] focus:ring-0 dark:border-zinc-700 dark:text-zinc-50"
                  />
                </label>
              </div>

              <div className="flex items-center justify-end gap-3">
                <a
                  href="/platform"
                  className="inline-flex h-11 items-center justify-center border-b border-zinc-300 px-1 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-500 hover:text-zinc-950 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-zinc-50"
                >
                  Cancelar
                </a>
                <button
                  type="submit"
                  className="inline-flex h-11 items-center justify-center border-b-2 border-[#003373] px-1 text-sm font-medium text-[#003373] transition-colors hover:border-[#0A4A9E] hover:text-[#0A4A9E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A4A9E]/20 dark:text-[#9FC2FF] dark:border-[#9FC2FF] dark:hover:text-white dark:hover:border-white"
                >
                  Guardar cambios
                </button>
              </div>
            </form>
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
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={`Vista previa del avatar de ${displayName}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    avatarFallback
                  )}
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
