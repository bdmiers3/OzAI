import type { ChatMessage, ChatMessageStatus } from "../../types";

const CONVERSATIONS_KEY = "oz.conversations.v1";
const ACTIVE_CONVERSATION_KEY = "oz.activeConversation.v1";
const MAX_CONVERSATIONS = 75;
const MAX_MESSAGES_PER_CONVERSATION = 200;

const VALID_STATUSES = new Set<ChatMessageStatus>([
  "pending",
  "complete",
  "stopped",
  "error",
]);

export interface SavedConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  titleEdited?: boolean;
}

export interface InitialConversationState {
  conversations: SavedConversation[];
  activeConversationId: string | null;
  messages: ChatMessage[];
}

function storageAvailable() {
  try {
    return typeof window !== "undefined" && Boolean(window.localStorage);
  } catch {
    return false;
  }
}

function cloneMessages(messages: ChatMessage[]) {
  return messages.map((message) => ({ ...message }));
}

function sanitizeMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<ChatMessage>;
  if (candidate.role !== "user" && candidate.role !== "assistant") return null;
  if (typeof candidate.content !== "string") return null;

  const content = candidate.content;
  if (candidate.role === "user" && !content.trim()) return null;

  let status = candidate.status;
  if (status && !VALID_STATUSES.has(status)) status = undefined;

  if (candidate.role === "assistant" && status === "pending") {
    if (!content.trim()) return null;
    status = "stopped";
  }

  if (candidate.role === "assistant" && !content.trim()) return null;

  return {
    id:
      typeof candidate.id === "string" && candidate.id
        ? candidate.id
        : createConversationId(),
    role: candidate.role,
    content,
    ...(status ? { status } : {}),
  };
}

export function sanitizeMessages(messages: unknown): ChatMessage[] {
  if (!Array.isArray(messages)) return [];

  return messages
    .map(sanitizeMessage)
    .filter((message): message is ChatMessage => Boolean(message))
    .slice(-MAX_MESSAGES_PER_CONVERSATION);
}

function sanitizeConversation(value: unknown): SavedConversation | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<SavedConversation>;
  if (typeof candidate.id !== "string" || !candidate.id) return null;

  const messages = sanitizeMessages(candidate.messages);
  if (messages.length === 0) return null;

  const createdAt = isValidDate(candidate.createdAt)
    ? candidate.createdAt!
    : new Date().toISOString();
  const updatedAt = isValidDate(candidate.updatedAt)
    ? candidate.updatedAt!
    : createdAt;

  return {
    id: candidate.id,
    title:
      typeof candidate.title === "string" && candidate.title.trim()
        ? candidate.title.trim().slice(0, 80)
        : titleForMessages(messages),
    messages,
    createdAt,
    updatedAt,
    titleEdited: candidate.titleEdited === true,
  };
}

function isValidDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function sortConversations(conversations: SavedConversation[]) {
  return [...conversations]
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    )
    .slice(0, MAX_CONVERSATIONS);
}

export function createConversationId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `conversation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function titleForMessages(messages: ChatMessage[]) {
  const firstPrompt = messages.find(
    (message) => message.role === "user" && message.content.trim(),
  )?.content;

  if (!firstPrompt) return "New conversation";

  const normalized = firstPrompt.replace(/\s+/g, " ").trim();
  return normalized.length > 48
    ? `${normalized.slice(0, 47).trimEnd()}…`
    : normalized;
}

export function loadConversations(): SavedConversation[] {
  if (!storageAvailable()) return [];

  try {
    const raw = window.localStorage.getItem(CONVERSATIONS_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return sortConversations(
      parsed
        .map(sanitizeConversation)
        .filter(
          (conversation): conversation is SavedConversation =>
            Boolean(conversation),
        ),
    );
  } catch (error) {
    console.warn("Oz could not load saved conversations.", error);
    return [];
  }
}

export function saveConversations(conversations: SavedConversation[]) {
  if (!storageAvailable()) return;

  try {
    window.localStorage.setItem(
      CONVERSATIONS_KEY,
      JSON.stringify(sortConversations(conversations)),
    );
  } catch (error) {
    console.warn("Oz could not save conversation history.", error);
  }
}

export function loadActiveConversationId() {
  if (!storageAvailable()) return null;
  return window.localStorage.getItem(ACTIVE_CONVERSATION_KEY);
}

export function saveActiveConversationId(conversationId: string | null) {
  if (!storageAvailable()) return;

  if (conversationId) {
    window.localStorage.setItem(ACTIVE_CONVERSATION_KEY, conversationId);
  } else {
    window.localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
  }
}

export function loadConversationState(): InitialConversationState {
  const conversations = loadConversations();
  const requestedActiveId = loadActiveConversationId();
  const activeConversation = conversations.find(
    (conversation) => conversation.id === requestedActiveId,
  );

  if (!activeConversation) {
    saveActiveConversationId(null);
    return {
      conversations,
      activeConversationId: null,
      messages: [],
    };
  }

  return {
    conversations,
    activeConversationId: activeConversation.id,
    messages: cloneMessages(activeConversation.messages),
  };
}

export function upsertConversation(
  conversations: SavedConversation[],
  conversationId: string | null,
  messages: ChatMessage[],
): SavedConversation[] {
  if (!conversationId) return conversations;

  const sanitizedMessages = sanitizeMessages(messages);
  if (sanitizedMessages.length === 0) return conversations;

  const existing = conversations.find(
    (conversation) => conversation.id === conversationId,
  );
  const messagesUnchanged =
    existing &&
    JSON.stringify(existing.messages) === JSON.stringify(sanitizedMessages);

  if (messagesUnchanged) return conversations;

  const now = new Date().toISOString();
  const updated: SavedConversation = {
    id: conversationId,
    title:
      existing?.titleEdited === true
        ? existing.title
        : titleForMessages(sanitizedMessages),
    titleEdited: existing?.titleEdited === true,
    messages: sanitizedMessages,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  return sortConversations([
    updated,
    ...conversations.filter(
      (conversation) => conversation.id !== conversationId,
    ),
  ]);
}
