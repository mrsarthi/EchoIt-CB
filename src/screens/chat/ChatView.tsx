import React, { useState, useRef, useEffect } from "react";
import { ArrowLeftIcon, LockIcon, PaperclipIcon, SendIcon } from "../../components/ui/Icons";
import { TwoStepsChecklist, type PairingState } from "../../components/pairing/TwoStepsChecklist";

export interface MessageItem {
  id: string;
  senderDid: string;
  isOutgoing: boolean;
  text: string;
  timestamp: string;
  status?: "staged" | "sent" | "delivered" | "read";
}

export interface ChatViewProps {
  peerDid: string;
  peerName: string;
  pairingState?: PairingState;
  isOnline?: boolean;
  /**
   * "Online", "last seen 5 minutes ago", or empty when we have never heard
   * from them. Phrased by `services/presence`, not decided here — the same
   * wording appears in the chat list and the two must not drift.
   */
  presenceLabel?: string;
  messages?: MessageItem[];
  onBack?: () => void;
  onSendMessage?: (text: string) => void;
  onShareTicket?: () => void;
  onConnectBack?: () => void;
}

export function ChatView({
  peerDid,
  peerName,
  pairingState = "bilateral_connected",
  isOnline = true,
  presenceLabel = "",
  messages = [],
  onBack,
  onSendMessage,
  onShareTicket,
  onConnectBack,
}: ChatViewProps) {
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isConnected = pairingState === "bilateral_connected";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!isConnected) return;
    const trimmed = inputText.trim();
    if (!trimmed) return;
    onSendMessage?.(trimmed);
    setInputText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === "Escape" && onBack) {
      e.preventDefault();
      onBack();
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    const target = e.target;
    target.style.height = "auto";
    target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: "var(--color-bg)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* 1:1 Chat Header */}
      <header
        style={{
          height: 60,
          padding: "0 var(--space-md)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: "var(--color-surface)",
          borderBottom: "1px solid var(--color-border)",
          flexShrink: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {onBack && (
            <button
              onClick={onBack}
              style={{
                width: 44,
                height: 44,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                border: "none",
                borderRadius: "var(--radius-full)",
                color: "var(--color-text)",
                cursor: "pointer",
                padding: 0,
              }}
              title="Back to conversation list"
              aria-label="Back"
            >
              <ArrowLeftIcon size={20} />
            </button>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "var(--radius-full)",
                backgroundColor: "var(--color-surface-dim)",
                border: "1px solid var(--color-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: "var(--font-weight-semibold)",
                fontSize: "var(--font-size-body-sm)",
                color: "var(--color-text)",
              }}
            >
              {peerName.slice(0, 1).toUpperCase()}
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    fontWeight: "var(--font-weight-semibold)",
                    fontSize: "var(--font-size-body)",
                    color: "var(--color-text)",
                  }}
                >
                  {peerName}
                </span>
                {/*
                  Green means *they were just here*, not "you are paired".
                  It used to be driven by `isConnected` — bilateral pairing —
                  so it lit up for a contact who had not opened the app in
                  weeks. `isOnline` now comes from real inbound activity.
                */}
                {isOnline && (
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      backgroundColor: "var(--color-success)",
                      display: "inline-block",
                    }}
                    title="Active recently"
                  />
                )}
              </div>
              {/*
                The peer's did:key used to render here. Removed at the user's
                request — the same identifier went from Profile in 0.1.2, for
                the same reason: noise to everyone who is not debugging.

                Presence took the slot. "Online" is deliberately conservative —
                it means we have heard from them inside the presence window,
                because the SDK has `onPeerConnected` and no matching
                disconnect. See services/presence.ts.
              */}
              {presenceLabel && (
                <div
                  style={{
                    fontSize: "var(--font-size-label)",
                    color:
                      presenceLabel === "Online"
                        ? "var(--color-success)"
                        : "var(--color-text-muted)",
                    lineHeight: 1.3,
                  }}
                >
                  {presenceLabel}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Security Bilateral Pairing Indicator */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 8px",
            borderRadius: "var(--radius-full)",
            backgroundColor: isConnected ? "var(--color-surface-dim)" : "var(--color-primary-subtle)",
            color: isConnected ? "var(--color-text-muted)" : "var(--color-primary)",
            fontSize: "var(--font-size-label)",
          }}
          title={isConnected ? "Messages go straight from your device to theirs" : "Mutual connection required before messages can be delivered"}
        >
          <LockIcon size={14} />
          <span>{isConnected ? "Connected directly" : "Pairing required"}</span>
        </div>
      </header>

      {/* Unilateral Pairing State Banner (Option B: Two Steps) */}
      {!isConnected && (
        <div style={{ padding: "var(--space-md) var(--space-md) 0" }}>
          <TwoStepsChecklist
            pairingState={pairingState}
            peerName={peerName}
            peerDid={peerDid}
            onShareTicket={onShareTicket}
            onConnectBack={onConnectBack}
          />
        </div>
      )}

      {/* Message Stream Area */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "var(--space-lg)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-md)",
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              color: "var(--color-text-muted)",
              padding: "var(--space-xl)",
              userSelect: "none",
            }}
          >
            <p
              style={{
                fontSize: "var(--font-size-body-sm)",
                margin: 0,
                maxWidth: "28ch",
                lineHeight: "var(--line-height-body-sm)",
              }}
            >
              {isConnected
                ? "No messages yet. Say hello."
                : "Messages will be delivered once both sides complete connection."}
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: msg.isOutgoing ? "flex-end" : "flex-start",
                maxWidth: "100%",
              }}
            >
              {/* Paper Message Bubble */}
              <div
                style={{
                  maxWidth: "80%",
                  padding: "10px 14px",
                  borderRadius: msg.isOutgoing ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                  backgroundColor: msg.isOutgoing ? "var(--color-primary-subtle)" : "var(--color-surface)",
                  border: msg.isOutgoing
                    ? !isConnected
                      ? "1px dashed var(--color-primary)"
                      : "1px solid transparent"
                    : "1px solid var(--color-border)",
                  color: "var(--color-text)",
                  fontSize: "var(--font-size-body)",
                  lineHeight: "var(--line-height-body)",
                  wordBreak: "break-word",
                  whiteSpace: "pre-wrap",
                  boxShadow: "var(--shadow-low)",
                }}
              >
                {msg.text}
              </div>

              {/* Timestamp & Status Receipt */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  marginTop: 4,
                  padding: "0 4px",
                  fontSize: "var(--font-size-label)",
                  color: "var(--color-text-muted)",
                }}
              >
                <span>{msg.timestamp}</span>
                {msg.isOutgoing && (
                  <>
                    <span>•</span>
                    <span>{!isConnected ? "Staged" : msg.status === "sent" ? "Sent" : msg.status === "delivered" ? "Delivered" : "Staged"}</span>
                  </>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Composer Bar */}
      <div
        style={{
          padding: "var(--space-sm) var(--space-md)",
          paddingBottom: "calc(var(--space-sm) + var(--safe-bottom))",
          backgroundColor: "var(--color-surface)",
          borderTop: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "flex-end",
          gap: "var(--space-sm)",
          flexShrink: 0,
        }}
      >
        <button
          style={{
            width: 40,
            height: 40,
            borderRadius: "var(--radius-full)",
            backgroundColor: "var(--color-surface-dim)",
            border: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-text-muted)",
            cursor: "not-allowed",
            opacity: 0.5,
            flexShrink: 0,
            outline: "none",
          }}
          title="Attach file (disabled in beta)"
          aria-label="Attach file"
          disabled
        >
          <PaperclipIcon size={18} />
        </button>

        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            backgroundColor: "var(--color-surface-dim)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-lg)",
            padding: "6px 12px",
            minHeight: 40,
            opacity: isConnected ? 1 : 0.6,
          }}
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={handleTextareaInput}
            onKeyDown={handleKeyDown}
            disabled={!isConnected}
            placeholder={
              isConnected
                ? "Type a message..."
                : "Composer paused until connection is complete"
            }
            style={{
              width: "100%",
              border: "none",
              background: "transparent",
              outline: "none",
              color: "var(--color-text)",
              fontFamily: "var(--font-family-body)",
              fontSize: "var(--font-size-body)",
              resize: "none",
              maxHeight: 120,
              lineHeight: 1.4,
              cursor: isConnected ? "text" : "not-allowed",
            }}
          />
        </div>

        <button
          onClick={handleSend}
          disabled={!isConnected || !inputText.trim()}
          style={{
            width: 40,
            height: 40,
            borderRadius: "var(--radius-full)",
            backgroundColor: isConnected && inputText.trim() ? "var(--color-primary)" : "var(--color-surface-dim)",
            color: isConnected && inputText.trim() ? "#FFFFFF" : "var(--color-text-muted)",
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: isConnected && inputText.trim() ? "pointer" : "default",
            flexShrink: 0,
            transition: "all var(--motion-duration-sm) var(--motion-ease)",
            outline: "none",
          }}
          title="Send message (Enter)"
          aria-label="Send message"
        >
          <SendIcon size={18} />
        </button>
      </div>
    </div>
  );
}
