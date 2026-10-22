import { PlatformShell } from "@/app/platform/platform-shell";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import {
  buildSections,
  strongCheckIsRevisor,
  type UserRole,
} from "@/lib/platform-roles";
import {
  deriveDisplayName,
  isMissingTableError,
  listChatContacts,
  loadChatDirectory,
  makeChatAdminClient,
  normalizeEmail,
  roleFromRow,
  type ChatConversation,
  type ChatParticipant,
} from "@/app/platform/chat/chat-data";
import { ChatView } from "@/app/platform/chat/chat-view";

function buildParticipant(
  row: { user_id?: unknown; email?: unknown; display_name?: unknown; role?: unknown },
  nameFallback: string | null,
  avatarUrl: string | null
): ChatParticipant | null {
  const userId = typeof row.user_id === "string" ? row.user_id.trim() : "";
  if (!userId) return null;
  const email = normalizeEmail(typeof row.email === "string" ? row.email : null) || null;
  const storedName =
    typeof row.display_name === "string" && row.display_name.trim()
      ? row.display_name.trim()
      : "";
  const role = roleFromRow(row as Record<string, unknown>) ?? "usuario";
  return {
    userId,
    email,
    displayName: storedName || nameFallback || deriveDisplayName(email),
    role,
    avatarUrl,
  };
}

export default async function ChatPage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (
    !url ||
    !anonKey ||
    url.includes("__REPLACE_ME__") ||
    anonKey.includes("__REPLACE_ME__")
  ) {
    return redirect(
      "/?error=" + encodeURIComponent("Configura Supabase primero (env vars).")
    );
  }

  const supabase = await createClient();

  let user: { id: string; email?: string | null } | null = null;
  try {
    const resp = await supabase.auth.getUser();
    if (!resp.error && resp.data?.user) {
      user = { id: resp.data.user.id, email: resp.data.user.email ?? null };
    }
  } catch {
    user = null;
  }
  if (!user) return redirect("/");

  let role: UserRole = "usuario";
  try {
    const strong = await strongCheckIsRevisor(supabase, user.id, {
      email: user.email ?? null,
    });
    role = strong.decidedRole;
  } catch {
    role = "usuario";
  }
  const sections = buildSections(role);

  const admin = makeChatAdminClient();
  const client = admin ?? supabase;

  const directory = await loadChatDirectory(client);
  const contacts = listChatContacts(directory, user.id, role);

  let conversations: ChatConversation[] = [];
  let tableMissing = false;

  try {
    const mine = await client
      .from("conversation_participants")
      .select("conversation_id")
      .eq("user_id", user.id);

    if (mine.error) {
      if (isMissingTableError(mine.error)) tableMissing = true;
      else console.warn("[chat] participants error:", mine.error.message);
    }

    const convIds = ((mine.data ?? []) as { conversation_id?: string }[])
      .map((row) => row.conversation_id)
      .filter((value): value is string => typeof value === "string" && !!value);

    if (convIds.length > 0) {
      const [convsRes, partsRes] = await Promise.all([
        client
          .from("conversations")
          .select("id, last_message_at, last_message_preview")
          .in("id", convIds)
          .order("last_message_at", { ascending: false })
          .limit(100),
        client
          .from("conversation_participants")
          .select("conversation_id, user_id, email, display_name, role")
          .in("conversation_id", convIds),
      ]);

      if (convsRes.error && isMissingTableError(convsRes.error)) {
        tableMissing = true;
      }

      const partsByConv = new Map<string, Record<string, unknown>[]>();
      for (const raw of (partsRes.data ?? []) as Record<string, unknown>[]) {
        const convId = typeof raw.conversation_id === "string" ? raw.conversation_id : "";
        if (!convId) continue;
        const list = partsByConv.get(convId) ?? [];
        list.push(raw);
        partsByConv.set(convId, list);
      }

      conversations = ((convsRes.data ?? []) as Record<string, unknown>[]).map((conv) => {
        const id = typeof conv.id === "string" ? conv.id : "";
        const participants = (partsByConv.get(id) ?? [])
          .map((raw) => {
            const email = normalizeEmail(typeof raw.email === "string" ? raw.email : null);
            const uid = typeof raw.user_id === "string" ? raw.user_id : "";
            const fallback = directory.nameByUserId.get(uid);
            return buildParticipant(
              raw,
              fallback ?? (email ? deriveDisplayName(email) : null),
              directory.avatarByUserId.get(uid) ?? null
            );
          })
          .filter((value): value is ChatParticipant => value !== null);

        const other = participants.find((p) => p.userId !== user.id) ?? null;

        return {
          id,
          lastMessageAt:
            typeof conv.last_message_at === "string" ? conv.last_message_at : null,
          lastMessagePreview:
            typeof conv.last_message_preview === "string"
              ? conv.last_message_preview
              : null,
          other,
        } satisfies ChatConversation;
      });
    }
  } catch (e) {
    console.warn("[chat] load exception:", e instanceof Error ? e.message : String(e));
  }

  return (
    <PlatformShell
      sections={sections}
      currentUserId={user.id}
      currentUserEmail={user.email ?? undefined}
    >
      <ChatView
        role={role}
        currentUserId={user.id}
        currentUserEmail={user.email ?? null}
        conversations={conversations}
        contacts={contacts}
        tableMissing={tableMissing}
      />
    </PlatformShell>
  );
}
