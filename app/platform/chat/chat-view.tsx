"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sileo } from "sileo";
import { createClient } from "@/utils/supabase/client";
import { Avatar } from "@/components/ui/avatar";
import {
  sendMessage,
  startConversation,
} from "@/app/platform/chat/actions";
import type {
  ChatContact,
  ChatConversation,
  ChatMessage,
  ChatParticipant,
} from "@/app/platform/chat/chat-data";

const PAGE_SIZE = 50;
const PREVIEW_LENGTH = 140;

type Props = {
  role: "revisor" | "usuario";
  currentUserId: string;
  currentUserEmail: string | null;
  conversations: ChatConversation[];
  contacts: ChatContact[];
  tableMissing: boolean;
};

type MessageRow = {
  id?: string;
  conversation_id?: string;
  sender_id?: string;
  sender_email?: string | null;
  body?: string;
  created_at?: string;
};

function mapMessageRow(row: MessageRow): ChatMessage | null {
  if (!row.id || !row.conversation_id || !row.sender_id || !row.created_at) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderEmail: row.sender_email ?? null,
    body: row.body ?? "",
    createdAt: row.created_at,
  };
}

function initialsOf(value: string) {
  const parts = value
    .split(/[\s@._-]+/g)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "");
  return parts.join("") || "?";
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

function dayKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatDayLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("es-MX", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function roleLabel(role: string) {
  return role === "revisor" ? "Revisor" : "Supervisor";
}

/** Cola de la burbuja (el pico inferior) al estilo WhatsApp. */
function BubbleTail({ mine }: { mine: boolean }) {
  return (
    <svg
      viewBox="0 0 8 13"
      width="8"
      height="13"
      aria-hidden="true"
      className={[
        "absolute bottom-0",
        mine
          ? "-right-[7px] text-[#c9edfa] dark:text-[#032f6c]"
          : "-left-[7px] text-white dark:text-[#0c2537]",
      ].join(" ")}
    >
      <path
        fill="currentColor"
        d={
          mine
            ? "M2.812 0H8v11.193L1.533 2.568C.474 1.156 1.042 0 2.812 0z"
            : "M5.188 0H0v11.193L6.467 2.568C7.526 1.156 6.958 0 5.188 0z"
        }
      />
    </svg>
  );
}

export function ChatView({
  currentUserId,
  conversations,
  contacts,
  tableMissing,
}: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const [newChatOpen, setNewChatOpen] = useState(false);
  const [listQuery, setListQuery] = useState("");
  const [contactQuery, setContactQuery] = useState("");
  const [startingId, setStartingId] = useState<string | null>(null);
  const [pendingOther, setPendingOther] = useState<ChatParticipant | null>(null);

  const [overrides, setOverrides] = useState<
    Record<string, { lastMessageAt: string; lastMessagePreview: string }>
  >({});

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const knownIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    knownIdsRef.current = new Set(conversations.map((c) => c.id));
  }, [conversations]);

  const ordered = useMemo(() => {
    const merged = conversations.map((conv) => {
      const override = overrides[conv.id];
      if (!override) return conv;
      return {
        ...conv,
        lastMessageAt: override.lastMessageAt,
        lastMessagePreview: override.lastMessagePreview,
      };
    });
    return merged.sort((a, b) => {
      const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bt - at;
    });
  }, [conversations, overrides]);

  const activeConversation = ordered.find((c) => c.id === selectedId) ?? null;
  const activeOther = activeConversation?.other ?? pendingOther;

  const visibleConversations = useMemo(() => {
    const query = listQuery.trim().toLowerCase();
    if (!query) return ordered;
    return ordered.filter((conv) => {
      const name = (conv.other?.displayName ?? "").toLowerCase();
      const email = (conv.other?.email ?? "").toLowerCase();
      const preview = (conv.lastMessagePreview ?? "").toLowerCase();
      return name.includes(query) || email.includes(query) || preview.includes(query);
    });
  }, [ordered, listQuery]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
  }, []);

  const loadMessages = useCallback(
    async (conversationId: string) => {
      setLoadingMessages(true);
      setHasMore(false);
      try {
        const { data, error } = await supabase
          .from("messages")
          .select("id, conversation_id, sender_id, sender_email, body, created_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(PAGE_SIZE);
        if (error) {
          sileo.error({ title: "No se pudieron cargar los mensajes." });
          setMessages([]);
          return;
        }
        const rows = ((data ?? []) as MessageRow[]).reverse();
        const mapped = rows
          .map(mapMessageRow)
          .filter((value): value is ChatMessage => value !== null);
        setMessages(mapped);
        setHasMore((data ?? []).length === PAGE_SIZE);
      } finally {
        setLoadingMessages(false);
      }
    },
    [supabase]
  );

  const loadOlder = useCallback(async () => {
    const conversationId = selectedIdRef.current;
    const first = messages[0];
    if (!conversationId || !first || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("id, conversation_id, sender_id, sender_email, body, created_at")
        .eq("conversation_id", conversationId)
        .lt("created_at", first.createdAt)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (error) {
        sileo.error({ title: "No se pudieron cargar mensajes anteriores." });
        return;
      }
      const older = ((data ?? []) as MessageRow[])
        .reverse()
        .map(mapMessageRow)
        .filter((value): value is ChatMessage => value !== null);
      setMessages((prev) => [...older, ...prev]);
      setHasMore((data ?? []).length === PAGE_SIZE);
    } finally {
      setLoadingOlder(false);
    }
  }, [messages, loadingOlder, supabase]);

  const openConversation = useCallback(
    (conversationId: string) => {
      setSelectedId(conversationId);
      void loadMessages(conversationId);
    },
    [loadMessages]
  );

  const closeConversation = useCallback(() => {
    setSelectedId(null);
    setPendingOther(null);
    setMessages([]);
    setHasMore(false);
  }, []);

  // Realtime: mensajes nuevos (hilo + vista previa de la lista).
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setup = async () => {
      // Al restaurar la sesión (recarga o navegación) el SDK no propaga el JWT
      // al socket de Realtime, así que el join sale sin `access_token` y RLS
      // descarta todos los eventos. Fijamos el token antes de suscribirnos.
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) await supabase.realtime.setAuth(token);
      if (cancelled) return;

      channel = supabase
        .channel("chat-live")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          (payload) => {
            const row = payload.new as MessageRow;
            if (!row?.conversation_id || !row.id) return;
            if (!knownIdsRef.current.has(row.conversation_id)) return;
            setOverrides((prev) => ({
              ...prev,
              [row.conversation_id as string]: {
                lastMessageAt: row.created_at ?? new Date().toISOString(),
                lastMessagePreview: (row.body ?? "").slice(0, PREVIEW_LENGTH),
              },
            }));
            if (row.conversation_id === selectedIdRef.current) {
              const mapped = mapMessageRow(row);
              if (!mapped) return;
              setMessages((prev) =>
                prev.some((m) => m.id === mapped.id) ? prev : [...prev, mapped]
              );
            }
          }
        )
        .subscribe();
    };

    void setup();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase]);

  // Realtime: me agregan a una conversación nueva.
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setup = async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) await supabase.realtime.setAuth(token);
      if (cancelled) return;

      channel = supabase
        .channel("chat-inbox")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "conversation_participants",
            filter: `user_id=eq.${currentUserId}`,
          },
          () => router.refresh()
        )
        .subscribe();
    };

    void setup();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, currentUserId, router]);

  // Autoscroll al fondo al abrir o recibir/enviar mensajes.
  useEffect(() => {
    scrollToBottom();
  }, [messages.length, selectedId, scrollToBottom]);

  const filteredContacts = useMemo(() => {
    const query = contactQuery.trim().toLowerCase();
    if (!query) return contacts;
    return contacts.filter(
      (contact) =>
        contact.displayName.toLowerCase().includes(query) ||
        (contact.email ?? "").toLowerCase().includes(query)
    );
  }, [contacts, contactQuery]);

  const handleSend = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const conversationId = selectedIdRef.current;
      const body = draft.trim();
      if (!conversationId || !body || sending) return;
      setSending(true);
      try {
        const formData = new FormData();
        formData.set("conversation_id", conversationId);
        formData.set("body", body);
        const result = await sendMessage(formData);
        if (!result.ok) {
          sileo.error({ title: result.error });
          return;
        }
        setDraft("");
        setMessages((prev) =>
          prev.some((m) => m.id === result.message.id)
            ? prev
            : [...prev, result.message]
        );
        setOverrides((prev) => ({
          ...prev,
          [conversationId]: {
            lastMessageAt: result.message.createdAt,
            lastMessagePreview: body.slice(0, PREVIEW_LENGTH),
          },
        }));
        scrollToBottom("smooth");
      } catch {
        sileo.error({ title: "No se pudo enviar el mensaje." });
      } finally {
        setSending(false);
      }
    },
    [draft, sending, scrollToBottom]
  );

  const handleStartConversation = useCallback(
    async (contact: ChatContact) => {
      if (startingId) return;
      setStartingId(contact.userId);
      try {
        const formData = new FormData();
        formData.set("target_user_id", contact.userId);
        const result = await startConversation(formData);
        if (!result.ok) {
          sileo.error({ title: result.error });
          return;
        }
        setPendingOther(contact);
        openConversation(result.conversationId);
        setNewChatOpen(false);
        setContactQuery("");
        router.refresh();
        if (result.created) {
          sileo.success({ title: "Conversación creada." });
        }
      } catch {
        sileo.error({ title: "No se pudo iniciar la conversación." });
      } finally {
        setStartingId(null);
      }
    },
    [router, startingId, openConversation]
  );

  if (tableMissing) {
    return (
      <div className="mx-auto w-full max-w-3xl rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
        <p className="font-medium text-amber-900 dark:text-amber-100">
          El módulo de Chat Directo aún no está disponible.
        </p>
        <p className="mt-2 text-amber-800/90 dark:text-amber-200/90">
          Aplica la migración{" "}
          <code className="rounded bg-amber-100 px-1 py-0.5 text-xs dark:bg-amber-900/50">
            20261022000000_create_chat.sql
          </code>{" "}
          en Supabase y recarga la página.
        </p>
      </div>
    );
  }

  return (
    // `-m-4` compensa el padding de `<main>` para pegar el chat a los bordes.
    <div className="-m-4">
      <div className="flex h-dvh overflow-hidden bg-white dark:bg-[#071a2b]">
        {/* Lista de conversaciones */}
        <aside
          className={[
            "w-full shrink-0 flex-col border-r border-[#dce9f3] dark:border-[#123048] md:flex md:w-[380px]",
            selectedId ? "hidden" : "flex",
          ].join(" ")}
        >
          <div className="flex items-center justify-between gap-2 bg-[#edf5fb] px-4 py-3 dark:bg-[#0c2537]">
            <h1 className="text-base font-medium text-[#0b2239] dark:text-[#e4f2fb]">
              Chats
            </h1>
            <button
              type="button"
              aria-label="Nuevo chat"
              onClick={() => setNewChatOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#5c7a93] transition-colors hover:bg-black/5 dark:text-[#a8c6db] dark:hover:bg-white/10"
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5">
                <path d="M12 20h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <div className="bg-white px-3 py-2 dark:bg-[#071a2b]">
            <div className="flex items-center gap-3 rounded-lg bg-[#edf5fb] px-3 py-2 dark:bg-[#0c2537]">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4 shrink-0 text-[#5c7a93] dark:text-[#8fb2c9]">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
                <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <input
                value={listQuery}
                onChange={(event) => setListQuery(event.target.value)}
                placeholder="Buscar un chat"
                className="w-full bg-transparent text-sm text-[#0b2239] outline-none placeholder:text-[#5c7a93] dark:text-[#e4f2fb] dark:placeholder:text-[#8fb2c9]"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-white dark:bg-[#071a2b]">
            {visibleConversations.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-[#5c7a93] dark:text-[#8fb2c9]">
                {ordered.length === 0
                  ? "Aún no tienes conversaciones. Inicia una nueva."
                  : "Sin resultados para tu búsqueda."}
              </div>
            ) : (
              <ul>
                {visibleConversations.map((conv) => {
                  const other = conv.other;
                  const name = other?.displayName ?? "Conversación";
                  const active = conv.id === selectedId;
                  return (
                    <li key={conv.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setPendingOther(null);
                          openConversation(conv.id);
                        }}
                        className={[
                          "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                          active
                            ? "bg-[#e2eff8] dark:bg-[#123b57]"
                            : "hover:bg-[#f3f9fc] dark:hover:bg-[#0c2537]",
                        ].join(" ")}
                      >
                        <Avatar
                          src={other?.avatarUrl ?? null}
                          alt={name}
                          initials={initialsOf(name)}
                          className="h-12 w-12 text-sm"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[15px] text-[#0b2239] dark:text-[#e4f2fb]">
                              {name}
                            </span>
                            {conv.lastMessageAt && (
                              <span className="shrink-0 text-[12px] tabular-nums text-[#5c7a93] dark:text-[#8fb2c9]">
                                {formatTime(conv.lastMessageAt)}
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block truncate text-[13px] text-[#5c7a93] dark:text-[#8fb2c9]">
                            {conv.lastMessagePreview ?? "Sin mensajes"}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Hilo */}
        <section
          className={[
            "min-w-0 flex-1 flex-col",
            selectedId ? "flex" : "hidden md:flex",
          ].join(" ")}
        >
          {selectedId ? (
            <>
              <div className="flex items-center gap-3 bg-[#edf5fb] px-4 py-2.5 dark:bg-[#0c2537]">
                <button
                  type="button"
                  aria-label="Volver"
                  onClick={closeConversation}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#5c7a93] transition-colors hover:bg-black/5 md:hidden dark:text-[#a8c6db] dark:hover:bg-white/10"
                >
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
                    <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <Avatar
                  src={activeOther?.avatarUrl ?? null}
                  alt={activeOther?.displayName ?? "Conversación"}
                  initials={initialsOf(activeOther?.displayName ?? "Conversación")}
                  className="h-10 w-10 text-xs"
                />
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium text-[#0b2239] dark:text-[#e4f2fb]">
                    {activeOther?.displayName ?? "Conversación"}
                  </p>
                  {activeOther && (
                    <p className="truncate text-[12px] text-[#5c7a93] dark:text-[#8fb2c9]">
                      {roleLabel(activeOther.role)}
                      {activeOther.email ? ` · ${activeOther.email}` : ""}
                    </p>
                  )}
                </div>
              </div>

              <div
                ref={scrollRef}
                className="wa-wallpaper min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-8"
              >
                {hasMore && (
                  <div className="mb-4 flex justify-center">
                    <button
                      type="button"
                      onClick={() => void loadOlder()}
                      disabled={loadingOlder}
                      className="rounded-full bg-white/95 px-3 py-1 text-xs text-[#5c7a93] shadow-sm transition-colors hover:bg-white disabled:opacity-60 dark:bg-[#0c2537] dark:text-[#9fc0d6] dark:hover:bg-[#123b57]"
                    >
                      {loadingOlder ? "Cargando…" : "Ver mensajes anteriores"}
                    </button>
                  </div>
                )}

                {loadingMessages ? (
                  <div className="flex h-full items-center justify-center text-sm text-[#5c7a93] dark:text-[#8fb2c9]">
                    Cargando mensajes…
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[#5c7a93] dark:text-[#8fb2c9]">
                    Envía el primer mensaje para comenzar la conversación.
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {messages.map((message, index) => {
                      const mine = message.senderId === currentUserId;
                      const prev = messages[index - 1];
                      const next = messages[index + 1];
                      const prevSameDay =
                        !!prev && dayKey(prev.createdAt) === dayKey(message.createdAt);
                      const nextSameDay =
                        !!next && dayKey(next.createdAt) === dayKey(message.createdAt);
                      const showDay = !prevSameDay;
                      const prevSame = prevSameDay && prev?.senderId === message.senderId;
                      const nextSame = nextSameDay && next?.senderId === message.senderId;
                      const showAvatar = !mine && !nextSame;
                      const isLastOfGroup = !nextSame;
                      return (
                        <div
                          key={message.id}
                          className={prevSame && !showDay ? "mt-0.5" : "mt-3"}
                        >
                          {showDay && (
                            <div className="my-3 flex justify-center">
                              <span className="rounded-lg bg-white/95 px-3 py-1 text-[12px] font-medium uppercase tracking-wide text-[#5c7a93] shadow-sm dark:bg-[#0c2537] dark:text-[#8fb2c9]">
                                {formatDayLabel(message.createdAt)}
                              </span>
                            </div>
                          )}
                          <div
                            className={[
                              "flex items-end gap-2 duration-200 animate-in fade-in slide-in-from-bottom-1",
                              mine ? "justify-end" : "justify-start",
                            ].join(" ")}
                          >
                            {!mine && (
                              <span className="w-8 shrink-0">
                                {showAvatar && (
                                  <Avatar
                                    src={activeOther?.avatarUrl ?? null}
                                    alt={activeOther?.displayName ?? ""}
                                    initials={initialsOf(activeOther?.displayName ?? "")}
                                    className="h-8 w-8 text-[11px]"
                                  />
                                )}
                              </span>
                            )}
                            <div
                              className={[
                                "relative max-w-[75%] rounded-lg shadow-sm",
                                mine
                                  ? "bg-[#c9edfa] dark:bg-[#032f6c]"
                                  : "bg-white dark:bg-[#0c2537]",
                                isLastOfGroup
                                  ? mine
                                    ? "rounded-br-none"
                                    : "rounded-bl-none"
                                  : "",
                              ].join(" ")}
                            >
                              <div className="overflow-hidden px-2.5 py-1.5">
                                <span className="text-[15px] leading-[20px] whitespace-pre-wrap break-words text-[#0b2239] dark:text-[#e4f2fb]">
                                  {message.body}
                                </span>
                                <span className="float-right ml-2 translate-y-[3px] text-[11px] leading-none tabular-nums text-[#5c7a93] dark:text-[#9fc0d6]">
                                  {formatTime(message.createdAt)}
                                </span>
                              </div>
                              {isLastOfGroup && <BubbleTail mine={mine} />}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <form
                onSubmit={handleSend}
                className="bg-[#edf5fb] px-4 py-2.5 dark:bg-[#0c2537]"
              >
                <div className="flex items-end gap-2">
                  <div className="flex flex-1 items-end rounded-full bg-white px-4 py-2 dark:bg-[#123b57]">
                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }}
                      rows={1}
                      placeholder="Escribe un mensaje"
                      className="max-h-32 min-h-5 flex-1 resize-none bg-transparent text-[15px] text-[#0b2239] outline-none placeholder:text-[#5c7a93] dark:text-[#e4f2fb] dark:placeholder:text-[#8fb2c9]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={sending || draft.trim().length === 0}
                    aria-label="Enviar"
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#009add] text-white transition-colors hover:bg-[#0084c0] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {sending ? (
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4 animate-spin">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                        <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-5 w-5">
                        <path d="M2.5 21.5l19-9.5-19-9.5 4.2 7.4 8.3 2.1-8.3 2.1-4.2 7.4z" />
                      </svg>
                    )}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4 border-b-[6px] border-[#009add] bg-[#edf5fb] px-8 text-center dark:bg-[#0c2537]">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-[#009add] shadow-sm dark:bg-[#123b57]">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-8 w-8">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <div className="space-y-1">
                <p className="text-3xl font-light text-[#214173] dark:text-[#e4f2fb]">
                  Chat Directo
                </p>
                <p className="text-sm text-[#5c7a93] dark:text-[#8fb2c9]">
                  Selecciona una conversación para empezar a enviar mensajes.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Modal: nuevo chat */}
      {newChatOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 duration-150 animate-in fade-in sm:items-center sm:p-6">
          <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl duration-200 animate-in fade-in zoom-in-95 slide-in-from-bottom-3 sm:rounded-2xl dark:bg-[#071a2b]">
            <div className="flex items-center justify-between bg-[#edf5fb] px-4 py-3.5 dark:bg-[#0c2537]">
              <h2 className="text-base font-medium text-[#0b2239] dark:text-[#e4f2fb]">
                Nuevo chat
              </h2>
              <button
                type="button"
                aria-label="Cerrar"
                onClick={() => {
                  setNewChatOpen(false);
                  setContactQuery("");
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#5c7a93] transition-colors hover:bg-black/5 dark:text-[#a8c6db] dark:hover:bg-white/10"
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="px-3 py-2">
              <div className="flex items-center gap-3 rounded-lg bg-[#edf5fb] px-3 py-2 dark:bg-[#0c2537]">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4 shrink-0 text-[#5c7a93] dark:text-[#8fb2c9]">
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <input
                  value={contactQuery}
                  onChange={(event) => setContactQuery(event.target.value)}
                  placeholder="Buscar por nombre o correo"
                  className="w-full bg-transparent text-sm text-[#0b2239] outline-none placeholder:text-[#5c7a93] dark:text-[#e4f2fb] dark:placeholder:text-[#8fb2c9]"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {filteredContacts.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-[#5c7a93] dark:text-[#8fb2c9]">
                  No hay usuarios disponibles.
                </div>
              ) : (
                <ul>
                  {filteredContacts.map((contact) => (
                    <li key={contact.userId}>
                      <button
                        type="button"
                        onClick={() => void handleStartConversation(contact)}
                        disabled={startingId !== null}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[#f3f9fc] disabled:opacity-60 dark:hover:bg-[#0c2537]"
                      >
                        <Avatar
                          src={contact.avatarUrl}
                          alt={contact.displayName}
                          initials={initialsOf(contact.displayName)}
                          className="h-12 w-12 text-sm"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] text-[#0b2239] dark:text-[#e4f2fb]">
                            {contact.displayName}
                          </span>
                          <span className="block truncate text-[13px] text-[#5c7a93] dark:text-[#8fb2c9]">
                            {roleLabel(contact.role)}
                            {contact.email ? ` · ${contact.email}` : ""}
                          </span>
                        </span>
                        {startingId === contact.userId && (
                          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4 animate-spin text-[#8fb2c9]">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                            <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                          </svg>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
