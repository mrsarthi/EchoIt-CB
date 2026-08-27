/**
 * Full-screen media viewer, in the shape people already know.
 *
 * WhatsApp and Telegram both do the same things and users expect all of them:
 * the media fills a black screen, the chrome says who sent it and when, it
 * closes on back or a tap outside, and you can move between the media in a
 * conversation without returning to the list.
 *
 * ## Decisions worth knowing
 *
 * **Black, not themed.** A viewer is for looking at the picture, and a light
 * surround changes how the image reads. Both reference apps do this, and it is
 * the one screen in the app that ignores the theme on purpose.
 *
 * **The Android back button closes it, and nothing else.** The viewer listens
 * for `echoit:back` at a higher priority than AppShell's own handler by
 * stopping propagation, so back closes the picture rather than leaving the
 * conversation underneath it. Without that, one press would do both.
 *
 * **Object URLs are revoked by whoever created them**, not here. This component
 * is handed a URL and does not own it; revoking on unmount would break a
 * caller that still wants to show a thumbnail.
 */

import { useCallback, useEffect, useState } from "react";

import { ArrowLeftIcon, ChevronRightIcon, ShareIcon, XIcon } from "../ui/Icons";
import { formatSize } from "../../services/attachment-format";

export interface ViewableMedia {
  /**
   * The content hash, so a caller can find the attachment this came from.
   *
   * Matching on size and mime instead was ambiguous: two files of the same
   * type and length in one conversation would resolve to whichever came first,
   * and Save would write the wrong one.
   */
  hash: string;
  /** Object URL for the bytes. Owned by the caller. */
  url: string;
  mime: string;
  size: number;
  name?: string;
  /** Who sent it, as the user knows them. */
  from: string;
  /** Unix ms. */
  at: number;
}

interface MediaViewerProps {
  items: ViewableMedia[];
  /** Which one to show first. */
  index: number;
  onClose: () => void;
  /** Save to the device. Absent while that is not wired up. */
  onSave?: (item: ViewableMedia) => void;
  saveState?: "idle" | "saving" | "saved" | "failed";
  saveError?: string;
}

export function MediaViewer({
  items,
  index,
  onClose,
  onSave,
  saveState = "idle",
  saveError,
}: MediaViewerProps) {
  const [current, setCurrent] = useState(index);
  const item = items[current];

  const go = useCallback(
    (delta: number) => {
      setCurrent((c) => Math.min(items.length - 1, Math.max(0, c + delta)));
    },
    [items.length],
  );

  /*
   * Back closes the viewer.
   *
   * `echoit:back` is dispatched by MainActivity for the hardware button. Both
   * this and AppShell listen; stopping propagation here means the topmost
   * surface wins, which is what a person expects from a stack of screens.
   * Registered with `capture` so it runs before AppShell's listener regardless
   * of which mounted first.
   */
  useEffect(() => {
    const onBack = (event: Event) => {
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("echoit:back", onBack, { capture: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("echoit:back", onBack, { capture: true });
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, go]);

  // Swiping between items, and down to dismiss — both reference apps do this
  // and a viewer that only closes by a small button feels broken on a phone.
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) =>
    setTouchStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart) return;
    const dx = e.changedTouches[0].clientX - touchStart.x;
    const dy = e.changedTouches[0].clientY - touchStart.y;
    setTouchStart(null);
    if (Math.abs(dy) > 90 && Math.abs(dy) > Math.abs(dx)) {
      onClose();
      return;
    }
    if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
  };

  if (!item) return null;

  const when = new Date(item.at).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const saveLabel =
    saveState === "saving" ? "Saving…"
      : saveState === "saved" ? "Saved"
        : saveState === "failed" ? "Retry save"
          : "Save";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        backgroundColor: "#000",
        display: "flex",
        flexDirection: "column",
        // The viewer covers the system bars too, so its own chrome has to sit
        // inside them rather than relying on #root's padding.
        paddingTop: "var(--safe-top)",
        paddingBottom: "var(--safe-bottom)",
      }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Who and when, as both reference apps show it. */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm)",
          padding: "var(--space-sm) var(--space-md)",
          color: "#fff",
          flexShrink: 0,
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            width: 40,
            height: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            color: "#fff",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <ArrowLeftIcon size={22} />
        </button>

        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <div
            style={{
              fontSize: "var(--font-size-body-sm)",
              fontWeight: "var(--font-weight-semibold)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {item.from}
          </div>
          <div style={{ fontSize: "var(--font-size-label)", opacity: 0.7 }}>
            {when}
            {items.length > 1 ? ` · ${current + 1} of ${items.length}` : ""}
          </div>
        </div>

        {onSave && (
          <button
            onClick={() => onSave(item)}
            disabled={saveState === "saving"}
            aria-label={saveLabel}
            title={saveLabel}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 12px",
              background: "rgba(255,255,255,0.12)",
              border: "none",
              borderRadius: "var(--radius-full)",
              color: "#fff",
              fontSize: "var(--font-size-label)",
              cursor: saveState === "saving" ? "default" : "pointer",
            }}
          >
            <ShareIcon size={16} />
            {saveLabel}
          </button>
        )}
      </header>

      {saveError && (
        <div
          style={{
            margin: "0 var(--space-md) var(--space-sm)",
            padding: "8px 12px",
            borderRadius: "var(--radius-md)",
            backgroundColor: "rgba(255,255,255,0.1)",
            color: "#fff",
            fontSize: "var(--font-size-label)",
            flexShrink: 0,
          }}
        >
          {saveError}
        </div>
      )}

      {/* The media itself. Tapping the surround closes, as it does elsewhere. */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {item.mime.startsWith("video/") ? (
          <video
            src={item.url}
            controls
            autoPlay
            playsInline
            style={{ maxWidth: "100%", maxHeight: "100%", outline: "none" }}
          />
        ) : (
          <img
            src={item.url}
            alt={item.name ?? "Attachment"}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
          />
        )}

        {current > 0 && (
          <ViewerArrow side="left" onClick={() => go(-1)} />
        )}
        {current < items.length - 1 && (
          <ViewerArrow side="right" onClick={() => go(1)} />
        )}
      </div>

      <footer
        style={{
          padding: "var(--space-sm) var(--space-md)",
          color: "rgba(255,255,255,0.75)",
          fontSize: "var(--font-size-label)",
          textAlign: "center",
          flexShrink: 0,
        }}
      >
        {item.name ? `${item.name} · ` : ""}
        {formatSize(item.size)}
      </footer>
    </div>
  );
}

/** Only shown when there is somewhere to go, so it never lies about having more. */
function ViewerArrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={side === "left" ? "Previous" : "Next"}
      style={{
        position: "absolute",
        [side]: 8,
        top: "50%",
        transform: `translateY(-50%) ${side === "left" ? "rotate(180deg)" : ""}`,
        width: 40,
        height: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.4)",
        border: "none",
        borderRadius: "var(--radius-full)",
        color: "#fff",
        cursor: "pointer",
        padding: 0,
      }}
    >
      <ChevronRightIcon size={22} />
    </button>
  );
}

/** Re-exported so callers do not reach past this module for the close icon. */
export { XIcon };
