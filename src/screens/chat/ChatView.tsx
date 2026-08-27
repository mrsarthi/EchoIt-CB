import React, { useState, useRef, useEffect } from "react";
import { ArrowLeftIcon, LockIcon, PaperclipIcon, SendIcon } from "../../components/ui/Icons";
import { AttachmentBubble } from "../../components/media/AttachmentBubble";
import { MediaViewer, type ViewableMedia } from "../../components/media/MediaViewer";
import { formatSize, isViewable, MAX_ATTACHMENT_BYTES } from "../../services/attachment-format";
import type { Attachment } from "../../services/attachments";
import { TwoStepsChecklist, type PairingState } from "../../components/pairing/TwoStepsChecklist";

export interface MessageItem {
  id: string;
  senderDid: string;
  isOutgoing: boolean;
  text: string;
  timestamp: string;
  status?: "staged" | "sent" | "delivered" | "read";
  /** Handles only. The bytes are fetched by AttachmentBubble on demand. */
  attachments?: readonly Attachment[];
  /** Unix ms, for the viewer's caption. */
  at?: number;
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
  /** Send one file. Rejects with a sentence worth showing. */
  onSendAttachment?: (file: File) => Promise<void>;
  /** Hand a non-media file to the device. Absent while that is not wired. */
  onOpenDocument?: (attachment: Attachment, url: string) => void;
  /** Save the media on screen to the device. Absent while that is not wired. */
  onSaveMedia?: (item: ViewableMedia) => void;
  saveState?: "idle" | "saving" | "saved" | "failed";
  saveError?: string;
  onShareTicket?: () => void;
  onConnectBack?: () => void;
}

export function ChatView({
  peerDid,
  peerName,
  pairingState = "bilateral_connected",
  // Absent evidence must not render as present. Defaulting to true meant any
  // caller that forgot to pass presence showed a green dot forever.
  isOnline = false,
  presenceLabel = "",
  messages = [],
  onBack,
  onSendMessage,
  onSendAttachment,
  onOpenDocument,
  onSaveMedia,
  saveState,
  saveError,
  onShareTicket,
  onConnectBack,
}: ChatViewProps) {
  const [inputText, setInputText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachError, setAttachError] = useState("");
  const [attaching, setAttaching] = useState(false);
  /** Which media the viewer is showing, if any. */
  const [viewing, setViewing] = useState<{ items: ViewableMedia[]; index: number } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isConnected = pairingState === "bilateral_connected";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /**
   * Pick a file and send it.
   *
   * A plain file input rather than the Tauri dialog plugin: it works in
   * WebView2 and in Android's webview, and needs no additional capability
   * grant. The permission surface stays exactly as it was.
   *
   * The size is checked here as well as in the service, so an oversized file is
   * refused the instant it is chosen rather than after it has been read into
   * memory and hashed.
   */
  const handleFilePicked = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Clear immediately so choosing the same file twice still fires a change.
    event.target.value = "";
    if (!file) return;

    setAttachError("");
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setAttachError(
        `${file.name} is ${formatSize(file.size)}. The limit is ${formatSize(MAX_ATTACHMENT_BYTES)}.`,
      );
      return;
    }

    setAttaching(true);
    try {
      await onSendAttachment?.(file);
    } catch (error) {
      setAttachError((error as Error).message || "Could not send that file.");
    } finally {
      setAttaching(false);
    }
  };

  /**
   * Open the full-screen viewer on one attachment.
   *
   * Only viewable media goes in the list to page through — a document sitting
   * between two photos would make the arrows lie about what comes next. The
   * other media are only offered if their bytes are already local, since
   * paging should never silently start a download.
   */
  const openViewer = (message: MessageItem, attachment: Attachment, url: string) => {
    if (!isViewable(attachment.mime)) {
      // A document cannot be shown here; opening it needs the device's own
      // handler, which is wired separately.
      onOpenDocument?.(attachment, url);
      return;
    }
    setViewing({
      items: [
        {
          hash: attachment.hash,
          url,
          mime: attachment.mime,
          size: attachment.size,
          name: attachment.name,
          from: message.isOutgoing ? "You" : peerName,
          at: message.at ?? Date.now(),
        },
      ],
      index: 0,
    });
  };

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
      {/*
        Room for two lines.
        
        This was a fixed 60px holding a single line. Presence added a second one
        under the name, and on a real phone the result was cramped: "Phone A"
        wrapped onto two lines with "Online" squeezed beneath it and the dot
        pressed against the pairing badge.

        `minHeight` rather than `height` so the header grows if the text needs
        it instead of compressing, and vertical padding so the two lines are not
        flush against the edges. Padding alone would have made the wrapping
        worse by taking width away, so the name is also kept to one line below.
      */}
      <header
        style={{
          minHeight: 68,
          padding: "var(--space-sm) var(--space-md)",
          gap: "var(--space-sm)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: "var(--color-surface)",
          borderBottom: "1px solid var(--color-border)",
          flexShrink: 0,
          zIndex: 10,
        }}
      >
        {/* minWidth: 0 lets this shrink so the name can ellipsize rather than
            wrap — a flex item will not shrink below its content without it. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: "1 1 auto" }}>
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

            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <span
                  style={{
                    fontWeight: "var(--font-weight-semibold)",
                    fontSize: "var(--font-size-body)",
                    color: "var(--color-text)",
                    // One line, truncated. A long nickname used to wrap and
                    // push the presence line into the header's edge.
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    minWidth: 0,
                  }}
                  title={peerName}
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
                      flexShrink: 0,
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
                    marginTop: 2,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
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
            flexShrink: 0,
            whiteSpace: "nowrap",
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
                {/*
                  Attachments above the caption, as both reference apps do it:
                  the picture is the message and the words are about it.
                */}
                {msg.attachments?.map((attachment) => (
                  <div key={attachment.hash} style={{ marginBottom: msg.text ? 8 : 0 }}>
                    <AttachmentBubble
                      attachment={attachment}
                      onOpen={(url) => openViewer(msg, attachment, url)}
                    />
                  </div>
                ))}
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
        {/*
          A plain file input, deliberately. The Tauri dialog plugin would mean
          another capability grant; this works in WebView2 and Android's webview
          as it stands. `accept` is left open because the point of the feature
          is that any file can be sent.
        */}
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFilePicked}
          style={{ display: "none" }}
          aria-hidden="true"
          tabIndex={-1}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={!isConnected || attaching}
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
            cursor: !isConnected || attaching ? "not-allowed" : "pointer",
            opacity: !isConnected || attaching ? 0.5 : 1,
            flexShrink: 0,
            outline: "none",
          }}
          title={
            !isConnected
              ? "Connect with each other before sending files"
              : attaching
                ? "Sending…"
                : "Attach a file"
          }
          aria-label="Attach a file"
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

      {/*
        Why a file could not be sent, next to the thing that would send it.
        Refusals are specific -- too big, unavailable, corrupt -- and saying
        which one it was is what makes "try again" useful rather than noise.
      */}
      {attachError && (
        <div
          style={{
            padding: "0 var(--space-md) var(--space-sm)",
            fontSize: "var(--font-size-label)",
            color: "var(--color-danger)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
          role="alert"
        >
          <span style={{ flex: "1 1 auto" }}>{attachError}</span>
          <button
            onClick={() => setAttachError("")}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--color-text-muted)",
              cursor: "pointer",
              padding: 4,
            }}
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </div>
      )}

      {viewing && (
        <MediaViewer
          items={viewing.items}
          index={viewing.index}
          onClose={() => setViewing(null)}
          onSave={onSaveMedia ? (item) => onSaveMedia(item) : undefined}
          saveState={saveState}
          saveError={saveError}
        />
      )}
    </div>
  );
}
