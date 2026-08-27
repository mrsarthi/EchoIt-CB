/**
 * An attachment inside a message bubble.
 *
 * Owns the whole lifecycle of one file: whether the bytes are here, fetching
 * them with progress, what to draw, and what to say when it fails.
 *
 * ## Fetch on tap, not on arrival
 *
 * A message carries a handle; the bytes stay put until asked for. Fetching
 * automatically would pull every file in a conversation over a link measured at
 * well under a megabyte a second, without anyone asking — on a phone that is
 * someone's data allowance. So a thumbnail-less placeholder appears with the
 * size on it, and one tap fetches.
 *
 * The exception is a file already stored locally, which needs no network and is
 * shown immediately. `blobs.has` is what distinguishes the two.
 *
 * ## Object URLs are not owned here
 *
 * They live in a cache keyed by content hash in `services/attachments`, and are
 * released when the client is torn down. See the note on `load` below for the
 * bug that taught us not to tie them to a component.
 */

import { useCallback, useEffect, useState } from "react";

import { useApp } from "../../context/AppContext";
import {
  describeBlobError,
  formatSize,
  isViewable,
} from "../../services/attachment-format";
import { attachmentUrl, haveAttachment, type Attachment } from "../../services/attachments";
import { AlertCircleIcon, PaperclipIcon } from "../ui/Icons";

interface AttachmentBubbleProps {
  attachment: Attachment;
  /** Called with the object URL once bytes are here and it is viewable. */
  onOpen?: (url: string) => void;
}

type State =
  | { kind: "idle" }
  | { kind: "loading"; received: number; total: number }
  | { kind: "ready"; url: string }
  | { kind: "failed"; message: string };

export function AttachmentBubble({ attachment, onOpen }: AttachmentBubbleProps) {
  const { client } = useApp();
  const [state, setState] = useState<State>({ kind: "idle" });

  /*
   * No revoking here.
   *
   * An earlier version revoked its URL on unmount, which tied a
   * document-lifetime resource to a component lifetime: leaving the
   * conversation killed the URL, and returning rendered an img pointing at a
   * dead one -- a broken-image icon, measured with fetch failing and
   * naturalWidth 0. The URL is owned by the cache in services/attachments,
   * keyed by content hash, and released when the client goes away.
   */
  const load = useCallback(async () => {
    if (!client || state.kind === "loading" || state.kind === "ready") return;
    setState({ kind: "loading", received: 0, total: attachment.size });
    try {
      const url = await attachmentUrl(client, attachment, (received, total) => {
        setState({ kind: "loading", received, total: total || attachment.size });
      });
      setState({ kind: "ready", url });
    } catch (error) {
      setState({ kind: "failed", message: describeBlobError(error) });
    }
  }, [client, attachment, state.kind]);

  // Already here means no network is involved, so there is nothing to ask.
  useEffect(() => {
    let live = true;
    if (!client) return;
    void haveAttachment(client, attachment).then((held) => {
      if (live && held) void load();
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, attachment.hash]);

  const viewable = isViewable(attachment.mime);
  const label = attachment.name ?? (viewable ? "Photo" : "File");

  if (state.kind === "ready" && viewable) {
    const isVideo = attachment.mime.startsWith("video/");
    return (
      <button
        onClick={() => onOpen?.(state.url)}
        style={{
          display: "block",
          padding: 0,
          border: "none",
          background: "transparent",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          cursor: "pointer",
          maxWidth: 240,
          position: "relative",
          lineHeight: 0,
        }}
        title={label}
      >
        {isVideo ? (
          // `preload="metadata"` gives a first frame without pulling the file
          // through the decoder twice; the bytes are already local by now.
          <video
            src={state.url}
            preload="metadata"
            muted
            playsInline
            style={{ maxWidth: 240, maxHeight: 280, display: "block" }}
          />
        ) : (
          <img
            src={state.url}
            alt={label}
            style={{ maxWidth: 240, maxHeight: 280, display: "block", objectFit: "cover" }}
          />
        )}
        {isVideo && <PlayBadge />}
      </button>
    );
  }

  // Everything else — documents, and media not fetched yet — is a row.
  const busy = state.kind === "loading";
  const percent = busy && state.total ? Math.round((state.received / state.total) * 100) : 0;

  return (
    <div style={{ maxWidth: 260 }}>
      <button
        onClick={state.kind === "ready" ? () => onOpen?.(state.url) : load}
        disabled={busy}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "10px 12px",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--color-border)",
          backgroundColor: "var(--color-surface-dim)",
          color: "var(--color-text)",
          cursor: busy ? "default" : "pointer",
          textAlign: "left",
        }}
        title={label}
      >
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: "var(--radius-sm)",
            backgroundColor: "var(--color-surface)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            color: state.kind === "failed" ? "var(--color-danger)" : "var(--color-text-muted)",
          }}
        >
          {state.kind === "failed" ? <AlertCircleIcon size={18} /> : <PaperclipIcon size={18} />}
        </span>

        <span style={{ minWidth: 0, flex: "1 1 auto" }}>
          <span
            style={{
              display: "block",
              fontSize: "var(--font-size-body-sm)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {label}
          </span>
          <span
            style={{
              display: "block",
              fontSize: "var(--font-size-label)",
              color: "var(--color-text-muted)",
            }}
          >
            {busy
              ? `${percent}% · ${formatSize(state.received)} of ${formatSize(state.total)}`
              : state.kind === "ready"
                ? `${formatSize(attachment.size)} · Open`
                : `${formatSize(attachment.size)} · Tap to download`}
          </span>
        </span>
      </button>

      {busy && (
        <div
          style={{
            height: 3,
            marginTop: 6,
            borderRadius: 2,
            backgroundColor: "var(--color-surface-dim)",
            overflow: "hidden",
          }}
          role="progressbar"
          aria-valuenow={percent}
        >
          <div
            style={{
              width: `${percent}%`,
              height: "100%",
              backgroundColor: "var(--color-primary)",
              transition: "width 120ms linear",
            }}
          />
        </div>
      )}

      {state.kind === "failed" && (
        <div
          style={{
            marginTop: 6,
            fontSize: "var(--font-size-label)",
            color: "var(--color-danger)",
          }}
        >
          {/* The SDK distinguishes too-large, unavailable and corrupt. Saying
              which one it was is the difference between "try again" being
              useful advice and being noise. */}
          {state.message}
        </div>
      )}
    </div>
  );
}

function PlayBadge() {
  return (
    <span
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          width: 48,
          height: 48,
          borderRadius: "var(--radius-full)",
          backgroundColor: "rgba(0,0,0,0.55)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="#fff" aria-hidden="true">
          <path d="M5 3.5v13l12-6.5z" />
        </svg>
      </span>
    </span>
  );
}
