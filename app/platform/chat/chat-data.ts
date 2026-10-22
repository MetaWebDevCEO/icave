import {
  createClient as createSupabaseAdminClient,
  type PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import {
  normalizeRole,
  normalizeRoleCode,
  type UserRole,
} from "@/lib/platform-roles";
import { safeListUsers } from "@/lib/safe-auth";

/** Cliente admin (service role) para operaciones de chat, o `null` si no hay key. */
export function makeChatAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (
    !url ||
    !serviceKey ||
    url.includes("__REPLACE_ME__") ||
    serviceKey.includes("__REPLACE_ME__") ||
    serviceKey.length < 20
  ) {
    return null;
  }
  try {
    return createSupabaseAdminClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  } catch {
    return null;
  }
}

export type ChatParticipant = {
  userId: string;
  email: string | null;
  displayName: string;
  role: UserRole;
  /** URL firmada del avatar (bucket `avatars`), o `null` si no tiene. */
  avatarUrl: string | null;
};

export type ChatContact = ChatParticipant;

export type ChatConversation = {
  id: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  other: ChatParticipant | null;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  senderEmail: string | null;
  body: string;
  createdAt: string;
};

export function normalizeEmail(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** Nombre visible a partir del metadata de auth o del correo. */
export function deriveDisplayName(
  email: string | null | undefined,
  metadata?: Record<string, unknown> | null
): string {
  if (metadata) {
    const candidate =
      typeof metadata.full_name === "string"
        ? metadata.full_name
        : typeof metadata.display_name === "string"
          ? metadata.display_name
          : typeof metadata.name === "string"
            ? metadata.name
            : "";
    if (candidate.trim()) return candidate.trim();
  }
  const normalized = normalizeEmail(email);
  if (!normalized) return "Sin nombre";
  const localPart = normalized.split("@")[0] ?? "usuario";
  return localPart
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function roleFromRow(row: Record<string, unknown>): UserRole | null {
  return (
    normalizeRole(row.role) ??
    normalizeRole(row.rol) ??
    normalizeRole(row.user_role) ??
    normalizeRole(row.type) ??
    normalizeRole(row.tipo) ??
    normalizeRoleCode(row.role_code)
  );
}

export function isMissingTableError(error: PostgrestError | null | undefined): boolean {
  if (!error) return false;
  const code = (error as unknown as { code?: string }).code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    message.includes("could not find the table") ||
    message.includes("schema cache")
  );
}

type Directory = {
  roleByUserId: Map<string, UserRole>;
  emailByUserId: Map<string, string>;
  nameByUserId: Map<string, string>;
  avatarByUserId: Map<string, string>;
};

/**
 * Construye el directorio de usuarios (rol + correo + nombre + avatar) usando
 * `user_roles` como fuente de rol y auth.users para nombres y avatares.
 */
export async function loadChatDirectory(client: SupabaseClient): Promise<Directory> {
  const roleByUserId = new Map<string, UserRole>();
  const emailByUserId = new Map<string, string>();
  const nameByUserId = new Map<string, string>();
  const avatarByUserId = new Map<string, string>();
  // Ruta de avatar pendiente de firmar (bucket + path) por usuario.
  const pendingAvatars = new Map<string, { bucket: string; path: string }>();

  try {
    // `select("*")` a propósito: la tabla `user_roles` no siempre tiene las
    // columnas heredadas (`rol`, `user_role`, `tipo`…). Pedirlas explícitamente
    // hace fallar la consulta completa y todos los roles quedaban vacíos, con
    // lo que cada contacto caía al rol por defecto ("Supervisor").
    const { data, error } = await client
      .from("user_roles")
      .select("*")
      .limit(5000);
    if (!error) {
      for (const raw of (data ?? []) as Record<string, unknown>[]) {
        const userId = typeof raw.user_id === "string" ? raw.user_id.trim() : "";
        if (!userId) continue;
        const role = roleFromRow(raw);
        if (role) roleByUserId.set(userId, role);
        const email = normalizeEmail(
          typeof raw.email === "string" ? raw.email : null
        );
        if (email) emailByUserId.set(userId, email);
      }
    }
  } catch {
    /* user_roles opcional / schema stale */
  }

  try {
    const users = await safeListUsers({ perPage: 500, label: "chat-directory" });
    for (const user of users) {
      if (!user.id) continue;
      const email = normalizeEmail(user.email);
      if (email) emailByUserId.set(user.id, email);
      nameByUserId.set(
        user.id,
        deriveDisplayName(user.email, user.user_metadata)
      );

      const metadata =
        user.user_metadata && typeof user.user_metadata === "object"
          ? (user.user_metadata as Record<string, unknown>)
          : null;
      const bucket =
        metadata && typeof metadata.avatar_bucket === "string"
          ? metadata.avatar_bucket.trim()
          : "";
      const path =
        metadata && typeof metadata.avatar_path === "string"
          ? metadata.avatar_path.trim()
          : "";
      if (bucket && path) pendingAvatars.set(user.id, { bucket, path });
    }
  } catch {
    /* sin service role: seguimos solo con user_roles */
  }

  // Firma las URLs de avatar agrupando por bucket (normalmente todos "avatars").
  if (pendingAvatars.size > 0) {
    const byBucket = new Map<string, { userId: string; path: string }[]>();
    for (const [userId, info] of pendingAvatars) {
      const list = byBucket.get(info.bucket) ?? [];
      list.push({ userId, path: info.path });
      byBucket.set(info.bucket, list);
    }

    await Promise.all(
      Array.from(byBucket.entries()).map(async ([bucketName, entries]) => {
        try {
          const { data, error } = await client.storage
            .from(bucketName)
            .createSignedUrls(
              entries.map((entry) => entry.path),
              60 * 10
            );
          if (error || !data) return;
          data.forEach((item, index) => {
            const entry = entries[index];
            if (!entry) return;
            if (item.signedUrl && !item.error) {
              avatarByUserId.set(entry.userId, item.signedUrl);
            }
          });
        } catch {
          /* storage opcional */
        }
      })
    );
  }

  return { roleByUserId, emailByUserId, nameByUserId, avatarByUserId };
}

/**
 * Contactos con los que el usuario puede iniciar una conversación.
 *  - Revisor: cualquier usuario de la plataforma.
 *  - Supervisor: únicamente revisores (no puede hablar con otros supervisores).
 */
export function listChatContacts(
  directory: Directory,
  currentUserId: string,
  currentRole: UserRole
): ChatContact[] {
  const { roleByUserId, emailByUserId, nameByUserId, avatarByUserId } = directory;
  const contacts: ChatContact[] = [];
  const seen = new Set<string>();

  const push = (userId: string, fallbackRole: UserRole) => {
    if (!userId || userId === currentUserId || seen.has(userId)) return;
    const role = roleByUserId.get(userId) ?? fallbackRole;
    if (currentRole === "usuario" && role !== "revisor") return;
    seen.add(userId);
    const email = emailByUserId.get(userId) ?? null;
    contacts.push({
      userId,
      email,
      displayName: nameByUserId.get(userId) ?? deriveDisplayName(email),
      role,
      avatarUrl: avatarByUserId.get(userId) ?? null,
    });
  };

  for (const [userId, role] of roleByUserId) push(userId, role);
  for (const userId of emailByUserId.keys()) push(userId, "usuario");

  contacts.sort((a, b) => a.displayName.localeCompare(b.displayName, "es"));
  return contacts;
}
