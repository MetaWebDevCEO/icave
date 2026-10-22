"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { resolveRoleForUser, type UserRole } from "@/lib/platform-roles";
import {
  deriveDisplayName,
  isMissingTableError,
  loadChatDirectory,
  makeChatAdminClient,
  normalizeEmail,
  type ChatMessage,
} from "@/app/platform/chat/chat-data";

const MAX_MESSAGE_LENGTH = 4000;
const PREVIEW_LENGTH = 140;

export type StartConversationResult =
  | { ok: true; conversationId: string; created: boolean }
  | { ok: false; error: string };

export type SendMessageResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; error: string };

const MISSING_TABLE_MESSAGE =
  "Falta aplicar la migración del Chat Directo. Ejecuta supabase/migrations/20261022000000_create_chat.sql en Supabase.";

type AuthedUser = { id: string; email: string | null };

async function getAuthedUser(): Promise<AuthedUser | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  } catch {
    return null;
  }
}

async function resolveUserRole(
  client: SupabaseClient,
  userId: string,
  email: string | null
): Promise<UserRole> {
  try {
    return await resolveRoleForUser(client, userId, { email });
  } catch {
    return "usuario";
  }
}

/** Busca una conversación 1:1 existente entre dos usuarios. */
async function findExistingConversation(
  client: SupabaseClient,
  userId: string,
  otherUserId: string
): Promise<string | null> {
  try {
    const mine = await client
      .from("conversation_participants")
      .select("conversation_id")
      .eq("user_id", userId);
    if (mine.error) return null;
    const convIds = ((mine.data ?? []) as { conversation_id?: string }[])
      .map((row) => row.conversation_id)
      .filter((value): value is string => typeof value === "string" && !!value);
    if (convIds.length === 0) return null;

    const shared = await client
      .from("conversation_participants")
      .select("conversation_id")
      .eq("user_id", otherUserId)
      .in("conversation_id", convIds)
      .limit(1);
    if (shared.error) return null;
    const found = (shared.data ?? [])[0] as { conversation_id?: string } | undefined;
    return typeof found?.conversation_id === "string" ? found.conversation_id : null;
  } catch {
    return null;
  }
}

/**
 * Crea (o recupera) una conversación directa con el usuario indicado.
 * Reglas: un supervisor NO puede iniciar conversación con otro supervisor.
 */
export async function startConversation(
  formData: FormData
): Promise<StartConversationResult> {
  const me = await getAuthedUser();
  if (!me) return { ok: false, error: "Sesión no válida." };

  const targetUserId = String(formData.get("target_user_id") ?? "").trim();
  if (!targetUserId) return { ok: false, error: "Selecciona un usuario." };
  if (targetUserId === me.id) {
    return { ok: false, error: "No puedes iniciar una conversación contigo mismo." };
  }

  const admin = makeChatAdminClient();
  const client = admin ?? (await createClient());

  const [myRole, targetRole] = await Promise.all([
    resolveUserRole(client, me.id, me.email),
    resolveUserRole(client, targetUserId, null),
  ]);

  if (myRole === "usuario" && targetRole === "usuario") {
    return {
      ok: false,
      error: "Los supervisores no pueden iniciar conversaciones entre sí.",
    };
  }

  const existing = await findExistingConversation(client, me.id, targetUserId);
  if (existing) {
    return { ok: true, conversationId: existing, created: false };
  }

  const directory = await loadChatDirectory(client);
  const myEmail = normalizeEmail(me.email) || directory.emailByUserId.get(me.id) || null;
  const targetEmail = directory.emailByUserId.get(targetUserId) ?? null;
  const myName = directory.nameByUserId.get(me.id) ?? deriveDisplayName(myEmail);
  const targetName = directory.nameByUserId.get(targetUserId) ?? deriveDisplayName(targetEmail);

  const nowIso = new Date().toISOString();
  const insertConversation = await client
    .from("conversations")
    .insert({
      created_by: me.id,
      last_message_at: nowIso,
      last_message_preview: "Conversación iniciada",
    })
    .select("id")
    .single();

  if (insertConversation.error || !insertConversation.data?.id) {
    if (isMissingTableError(insertConversation.error)) {
      return { ok: false, error: MISSING_TABLE_MESSAGE };
    }
    return {
      ok: false,
      error: insertConversation.error?.message ?? "No se pudo crear la conversación.",
    };
  }

  const conversationId = insertConversation.data.id as string;

  const insertParticipants = await client
    .from("conversation_participants")
    .insert([
      { conversation_id: conversationId, user_id: me.id, email: myEmail, display_name: myName, role: myRole },
      { conversation_id: conversationId, user_id: targetUserId, email: targetEmail, display_name: targetName, role: targetRole },
    ]);

  if (insertParticipants.error) {
    if (isMissingTableError(insertParticipants.error)) {
      return { ok: false, error: MISSING_TABLE_MESSAGE };
    }
    return {
      ok: false,
      error: insertParticipants.error.message ?? "No se pudieron registrar los participantes.",
    };
  }

  revalidatePath("/platform/chat");
  return { ok: true, conversationId, created: true };
}

/** Envía un mensaje dentro de una conversación de la que el usuario es participante. */
export async function sendMessage(formData: FormData): Promise<SendMessageResult> {
  const me = await getAuthedUser();
  if (!me) return { ok: false, error: "Sesión no válida." };

  const conversationId = String(formData.get("conversation_id") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  if (!conversationId) return { ok: false, error: "Conversación no válida." };
  if (!body) return { ok: false, error: "Escribe un mensaje." };
  if (body.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: `El mensaje supera ${MAX_MESSAGE_LENGTH} caracteres.` };
  }

  const admin = makeChatAdminClient();
  const client = admin ?? (await createClient());

  const membership = await client
    .from("conversation_participants")
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", me.id)
    .maybeSingle();

  if (membership.error) {
    if (isMissingTableError(membership.error)) {
      return { ok: false, error: MISSING_TABLE_MESSAGE };
    }
  }
  if (!membership.error && !membership.data) {
    return { ok: false, error: "No participas en esta conversación." };
  }

  const inserted = await client
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: me.id,
      sender_email: normalizeEmail(me.email) || null,
      body,
    })
    .select("id, conversation_id, sender_id, sender_email, body, created_at")
    .single();

  if (inserted.error || !inserted.data) {
    if (isMissingTableError(inserted.error)) {
      return { ok: false, error: MISSING_TABLE_MESSAGE };
    }
    return { ok: false, error: inserted.error?.message ?? "No se pudo enviar el mensaje." };
  }

  await client
    .from("conversations")
    .update({
      last_message_at: inserted.data.created_at,
      last_message_preview: body.slice(0, PREVIEW_LENGTH),
    })
    .eq("id", conversationId);

  const row = inserted.data as {
    id: string;
    conversation_id: string;
    sender_id: string;
    sender_email: string | null;
    body: string;
    created_at: string;
  };

  return {
    ok: true,
    message: {
      id: row.id,
      conversationId: row.conversation_id,
      senderId: row.sender_id,
      senderEmail: row.sender_email,
      body: row.body,
      createdAt: row.created_at,
    },
  };
}
