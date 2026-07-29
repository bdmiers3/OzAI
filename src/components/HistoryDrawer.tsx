import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { SavedConversation } from "../services/conversations/conversationStore";

interface HistoryDrawerProps {
  open: boolean;
  conversations: SavedConversation[];
  activeConversationId: string | null;
  disabled: boolean;
  onClose: () => void;
  onNewConversation: () => void;
  onOpenConversation: (conversationId: string) => void;
  onRenameConversation: (conversationId: string, title: string) => void;
  onDeleteConversation: (conversationId: string) => void;
  onClearHistory: () => void;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 19 3.5-.8L18 7.7 14.3 4 3.8 14.5 3 18z" />
      <path d="m12.8 5.5 3.7 3.7" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M9 3h6l1 4H8zM7 7l1 14h8l1-14" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function dateGroupLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const startOfDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const dayDifference = Math.round(
    (startOfToday.getTime() - startOfDate.getTime()) / 86_400_000,
  );

  if (dayDifference === 0) return "Today";
  if (dayDifference === 1) return "Yesterday";
  if (dayDifference < 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date);
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).format(date);
}

function conversationMeta(conversation: SavedConversation) {
  const promptCount = conversation.messages.filter(
    (message) => message.role === "user",
  ).length;
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(conversation.updatedAt));

  return `${promptCount} ${promptCount === 1 ? "prompt" : "prompts"} · ${time}`;
}

export function HistoryDrawer({
  open,
  conversations,
  activeConversationId,
  disabled,
  onClose,
  onNewConversation,
  onOpenConversation,
  onRenameConversation,
  onDeleteConversation,
  onClearHistory,
}: HistoryDrawerProps) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setEditingId(null);
      return;
    }

    requestAnimationFrame(() => searchRef.current?.focus());

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const filteredConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return conversations;

    return conversations.filter((conversation) => {
      if (conversation.title.toLowerCase().includes(normalizedQuery)) return true;
      return conversation.messages.some((message) =>
        message.content.toLowerCase().includes(normalizedQuery),
      );
    });
  }, [conversations, query]);

  const groups = useMemo(() => {
    const grouped = new Map<string, SavedConversation[]>();

    for (const conversation of filteredConversations) {
      const label = dateGroupLabel(conversation.updatedAt);
      const existing = grouped.get(label) ?? [];
      existing.push(conversation);
      grouped.set(label, existing);
    }

    return [...grouped.entries()];
  }, [filteredConversations]);

  if (!open) return null;

  function beginRename(conversation: SavedConversation) {
    setEditingId(conversation.id);
    setTitleDraft(conversation.title);
  }

  function submitRename(event: FormEvent, conversationId: string) {
    event.preventDefault();
    const title = titleDraft.trim();
    if (title) onRenameConversation(conversationId, title);
    setEditingId(null);
  }

  return (
    <div className="history-layer" role="presentation">
      <button
        type="button"
        className="history-backdrop"
        aria-label="Close conversation history"
        onClick={onClose}
      />
      <aside className="history-drawer" aria-label="Conversation history">
        <div className="history-drawer__header">
          <div>
            <span>CONVERSATIONS</span>
            <h2>History</h2>
          </div>
          <button
            type="button"
            className="history-icon-button"
            aria-label="Close history"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        <button
          type="button"
          className="history-new-button"
          onClick={onNewConversation}
          disabled={disabled}
        >
          <span aria-hidden="true">＋</span>
          New conversation
        </button>

        <label className="history-search">
          <SearchIcon />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
          />
        </label>

        <div className="history-list">
          {groups.length === 0 ? (
            <div className="history-empty">
              <strong>{conversations.length === 0 ? "No saved chats yet" : "No matches"}</strong>
              <span>
                {conversations.length === 0
                  ? "Your conversations will appear here automatically."
                  : "Try a different search."}
              </span>
            </div>
          ) : (
            groups.map(([label, group]) => (
              <section className="history-group" key={label}>
                <h3>{label}</h3>
                <div>
                  {group.map((conversation) => {
                    const active = conversation.id === activeConversationId;
                    const editing = conversation.id === editingId;

                    return (
                      <article
                        key={conversation.id}
                        className={`history-item${active ? " is-active" : ""}`}
                      >
                        {editing ? (
                          <form
                            className="history-rename"
                            onSubmit={(event) =>
                              submitRename(event, conversation.id)
                            }
                          >
                            <input
                              value={titleDraft}
                              maxLength={80}
                              onChange={(event) => setTitleDraft(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                  event.stopPropagation();
                                  setEditingId(null);
                                }
                              }}
                              autoFocus
                              aria-label="Conversation title"
                            />
                            <button type="submit">Save</button>
                          </form>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="history-item__main"
                              onClick={() => onOpenConversation(conversation.id)}
                              disabled={disabled}
                            >
                              <strong>{conversation.title}</strong>
                              <span>{conversationMeta(conversation)}</span>
                            </button>
                            <div className="history-item__actions">
                              <button
                                type="button"
                                aria-label={`Rename ${conversation.title}`}
                                title="Rename"
                                onClick={() => beginRename(conversation)}
                                disabled={disabled}
                              >
                                <EditIcon />
                              </button>
                              <button
                                type="button"
                                aria-label={`Delete ${conversation.title}`}
                                title="Delete"
                                onClick={() => onDeleteConversation(conversation.id)}
                                disabled={disabled}
                              >
                                <TrashIcon />
                              </button>
                            </div>
                          </>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>

        {conversations.length > 0 && (
          <button
            type="button"
            className="history-clear-button"
            onClick={onClearHistory}
            disabled={disabled}
          >
            Clear conversation history
          </button>
        )}
      </aside>
    </div>
  );
}
