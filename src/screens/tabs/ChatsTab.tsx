import { useState, useCallback, useEffect, useRef } from "react";
import { SearchIcon, PlusIcon, ShieldIcon } from "../../components/ui/Icons";
import { Logo } from "../../components/ui/Logo";
import { Badge } from "../../components/ui/Badge";

export interface ConversationItem {
  id: string;
  peerDid: string;
  name: string;
  lastMessage?: string;
  timestamp?: string;
  unreadCount?: number;
  isOnline?: boolean;
}

export interface ChatsTabProps {
  conversations: ConversationItem[];
  selectedChatId?: string | null;
  onSelectChat: (id: string) => void;
  onNewChat?: () => void;
}

export function ChatsTab({
  conversations,
  selectedChatId,
  onSelectChat,
  onNewChat,
}: ChatsTabProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = conversations.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.peerDid.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.lastMessage && c.lastMessage.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Reset focused index when the list changes
  useEffect(() => {
    setFocusedIndex(-1);
  }, [searchQuery, conversations.length]);

  // Arrow key navigation through conversation list
  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (filtered.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev < filtered.length - 1 ? prev + 1 : 0;
          // Scroll focused item into view
          const items = listRef.current?.querySelectorAll<HTMLElement>("[data-chat-item]");
          items?.[next]?.scrollIntoView({ block: "nearest" });
          return next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev > 0 ? prev - 1 : filtered.length - 1;
          const items = listRef.current?.querySelectorAll<HTMLElement>("[data-chat-item]");
          items?.[next]?.scrollIntoView({ block: "nearest" });
          return next;
        });
      } else if (e.key === "Enter" && focusedIndex >= 0 && focusedIndex < filtered.length) {
        e.preventDefault();
        onSelectChat(filtered[focusedIndex]!.id);
      }
    },
    [filtered, focusedIndex, onSelectChat]
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: "var(--color-bg)",
        overflow: "hidden",
      }}
    >
      {/* Tab Header */}
      <header
        style={{
          padding: "var(--space-lg) var(--space-lg) var(--space-md)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-md)",
          backgroundColor: "var(--color-surface)",
          borderBottom: "1px solid var(--color-border)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Logo size={28} />
            <h1
              style={{
                fontSize: "var(--font-size-h3)",
                fontFamily: "var(--font-family-headline)",
                margin: 0,
              }}
            >
              Chats
            </h1>
          </div>

          {onNewChat && (
            <button
              onClick={onNewChat}
              style={{
                width: 36,
                height: 36,
                borderRadius: "var(--radius-full)",
                backgroundColor: "var(--color-primary)",
                color: "#FFFFFF",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                outline: "none",
                transition: "transform var(--motion-duration-sm) var(--motion-ease)",
              }}
              title="Start a new conversation"
              aria-label="Start a new conversation"
            >
              <PlusIcon size={18} />
            </button>
          )}
        </div>

        {/* Search Input */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 12px",
            height: 40,
            backgroundColor: "var(--color-surface-dim)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <SearchIcon size={16} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations..."
            style={{
              flex: 1,
              border: "none",
              background: "transparent",
              outline: "none",
              color: "var(--color-text)",
              fontFamily: "var(--font-family-body)",
              fontSize: "var(--font-size-body-sm)",
            }}
          />
        </div>
      </header>

      {/* Conversation List / Empty State */}
      <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-sm)" }}>
        {filtered.length === 0 ? (
          <div
            style={{
              height: "100%",
              minHeight: 240,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              padding: "var(--space-xl)",
              color: "var(--color-text-muted)",
            }}
          >
            <Logo size={48} style={{ marginBottom: "var(--space-md)" }} />
            <h3
              style={{
                fontSize: "var(--font-size-body)",
                fontFamily: "var(--font-family-headline)",
                color: "var(--color-text)",
                margin: 0,
              }}
            >
              No conversations yet
            </h3>
            <p
              style={{
                fontSize: "var(--font-size-body-sm)",
                color: "var(--color-text-muted)",
                marginTop: 6,
                maxWidth: "28ch",
                lineHeight: "var(--line-height-body-sm)",
              }}
            >
              Share your ticket from your Profile tab or add a contact to start messaging.
            </p>
          </div>
        ) : (
          <div
            ref={listRef}
            style={{ display: "flex", flexDirection: "column", gap: 4 }}
            onKeyDown={handleListKeyDown}
            role="listbox"
            aria-label="Conversations"
          >
            {filtered.map((chat) => {
              const isSelected = selectedChatId === chat.id;
              return (
                <div
                  key={chat.id}
                  onClick={() => onSelectChat(chat.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-md)",
                    padding: "10px 12px",
                    borderRadius: "var(--radius-md)",
                    backgroundColor: isSelected
                      ? "var(--color-primary-subtle)"
                      : "var(--color-surface)",
                    border: `1px solid ${isSelected ? "var(--color-primary)" : "var(--color-border)"}`,
                    cursor: "pointer",
                    transition: "all var(--motion-duration-sm) var(--motion-ease)",
                    userSelect: "none",
                  }}
                  role="option"
                  aria-selected={isSelected}
                  data-chat-item
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectChat(chat.id);
                    }
                    // Delegate arrow keys to parent handler
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      handleListKeyDown(e);
                    }
                  }}
                >
                  {/* Peer Avatar Initial */}
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: "var(--radius-full)",
                      backgroundColor: "var(--color-surface-dim)",
                      border: "1px solid var(--color-border)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: "var(--font-weight-semibold)",
                      fontSize: "var(--font-size-body)",
                      color: "var(--color-text)",
                      flexShrink: 0,
                      position: "relative",
                    }}
                  >
                    {chat.name.slice(0, 1).toUpperCase()}
                    {chat.isOnline && (
                      <span
                        style={{
                          position: "absolute",
                          bottom: 0,
                          right: 0,
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          backgroundColor: "var(--color-success)",
                          border: "2px solid var(--color-surface)",
                        }}
                      />
                    )}
                  </div>

                  {/* Chat Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 2,
                      }}
                    >
                      <span
                        style={{
                          fontSize: "var(--font-size-body-sm)",
                          fontWeight: "var(--font-weight-semibold)",
                          color: "var(--color-text)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {chat.name}
                      </span>
                      {chat.timestamp && (
                        <span
                          style={{
                            fontSize: "var(--font-size-label)",
                            color: "var(--color-text-muted)",
                            flexShrink: 0,
                            marginLeft: 6,
                          }}
                        >
                          {chat.timestamp}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: "var(--font-size-body-sm)",
                        color: "var(--color-text-muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {chat.lastMessage || "No messages yet"}
                      </span>
                      {chat.unreadCount && chat.unreadCount > 0 ? (
                        <Badge variant="default" style={{ marginLeft: 6, flexShrink: 0 }}>
                          {chat.unreadCount}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
