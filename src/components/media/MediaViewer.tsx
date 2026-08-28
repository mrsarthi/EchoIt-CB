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
 * **The Android back button closes it, and nothing else.** The viewer takes the
 * top of the back-handler stack while it is open, so back closes the picture
 * and leaves the conversation underneath it untouched. An earlier version used
 * a capture listener and `stopImmediatePropagation`, which cannot work for an
 * event dispatched on `window` — see services/back-stack.
 *
 * **Object URLs are revoked by whoever created them**, not here. This component
 * is handed a URL and does not own it; revoking on unmount would break a
 * caller that still wants to show a thumbnail.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { ArrowLeftIcon, ChevronRightIcon, ShareIcon, XIcon } from "../ui/Icons";
import { formatSize } from "../../services/attachment-format";
import { pushBackHandler } from "../../services/back-stack";

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
    // Pushed last, so asked first. See services/back-stack for why a capture
    // listener could never have worked here.
    const release = pushBackHandler(() => {
      onClose();
      return true;
    });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);

    return () => {
      release();
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, go]);

  /*
   * Pinch to zoom the picture, not the page.
   *
   * Browser pinch zooms the whole document, which is why it is switched off
   * app-wide (`user-scalable=no` plus `touch-action: pan-x pan-y`) after being
   * reported as "the entire application is zoomable". Zooming a photo is still
   * a real need, so it is done here by transforming the media element: the
   * chrome stays put and readable, which is how the reference apps behave.
   *
   * Gestures share one surface, so which one applies depends on the state:
   *
   *   two fingers            always pinch
   *   one finger, zoomed in  pan around the picture
   *   one finger, at 1x      swipe between items, or down to dismiss
   *
   * Without that last distinction, panning a zoomed photo sideways would page
   * to the next one, which is maddening.
   */
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const gesture = useRef<{
    mode: "none" | "pan" | "pinch";
    startX: number;
    startY: number;
    startOffset: { x: number; y: number };
    startDistance: number;
    startZoom: number;
  }>({ mode: "none", startX: 0, startY: 0, startOffset: { x: 0, y: 0 }, startDistance: 0, startZoom: 1 });

  // Reset when the picture changes; otherwise the next one opens mid-zoom,
  // scrolled to wherever the previous one was left.
  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [current]);

  const distanceBetween = (touches: React.TouchList) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length >= 2) {
      gesture.current = {
        mode: "pinch",
        startX: 0,
        startY: 0,
        startOffset: offset,
        startDistance: distanceBetween(e.touches),
        startZoom: zoom,
      };
      return;
    }
    gesture.current = {
      mode: "pan",
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      startOffset: offset,
      startDistance: 0,
      startZoom: zoom,
    };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const g = gesture.current;

    if (g.mode === "pinch" && e.touches.length >= 2) {
      const ratio = distanceBetween(e.touches) / (g.startDistance || 1);
      // Floor at 1: pinching below actual size just leaves a small picture in
      // a large black field. Ceiling at 6 so it cannot be lost off-screen.
      setZoom(Math.min(6, Math.max(1, g.startZoom * ratio)));
      return;
    }

    if (g.mode === "pan" && zoom > 1 && e.touches.length === 1) {
      setOffset({
        x: g.startOffset.x + (e.touches[0].clientX - g.startX),
        y: g.startOffset.y + (e.touches[0].clientY - g.startY),
      });
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const g = gesture.current;
    gesture.current = { ...g, mode: "none" };

    if (g.mode === "pinch") {
      // Snapping back to centre at 1x avoids a picture that is nominally
      // unzoomed but nudged off to one side.
      if (zoom <= 1.02) {
        setZoom(1);
        setOffset({ x: 0, y: 0 });
      }
      return;
    }

    // Zoomed in, a drag was a pan, not a navigation.
    if (g.mode !== "pan" || zoom > 1) return;

    const dx = e.changedTouches[0].clientX - g.startX;
    const dy = e.changedTouches[0].clientY - g.startY;
    if (Math.abs(dy) > 90 && Math.abs(dy) > Math.abs(dx)) {
      onClose();
      return;
    }
    if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
  };

  /** Double tap toggles, the way every photo viewer does. */
  const lastTap = useRef(0);
  const onMediaClick = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      setZoom((z) => (z > 1 ? 1 : 2.5));
      setOffset({ x: 0, y: 0 });
    }
    lastTap.current = now;
  };

  const mediaStyle: React.CSSProperties = {
    maxWidth: "100%",
    maxHeight: "100%",
    objectFit: "contain",
    transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
    // No transition while pinching, or the picture lags the fingers.
    transition: gesture.current.mode === "none" ? "transform 140ms ease-out" : "none",
    touchAction: "none",
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
      onTouchMove={onTouchMove}
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
          // Not while zoomed: releasing a pan on the surround would dismiss
          // the picture the user is in the middle of examining.
          if (zoom === 1 && e.target === e.currentTarget) onClose();
        }}
      >
        {item.mime.startsWith("video/") ? (
          <video
            src={item.url}
            controls
            autoPlay
            playsInline
            style={{ ...mediaStyle, outline: "none" }}
          />
        ) : (
          <img
            src={item.url}
            alt={item.name ?? "Attachment"}
            style={mediaStyle}
            onClick={onMediaClick}
            draggable={false}
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
