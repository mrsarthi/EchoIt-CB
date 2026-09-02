import { useLayoutEffect, useState } from "react";
import { QUICK_REACTIONS } from "../../services/reactions";

/**
 * The six quick reactions, parked next to the picked message.
 *
 * A bar at the bottom of the chat was the first version and is wrong: the
 * selection is on a bubble, often in the middle of a long thread, and a
 * tray by the composer looks like it belongs to the next send. Fixed
 * positioning against the bubble's box is what keeps the two together when
 * the list scrolls.
 */
export function ReactionPicker({
  messageId,
  stream,
  onPick,
}: {
  messageId: string;
  stream: HTMLElement | null;
  onPick: (emoji: string) => void;
}) {
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      if (!stream) return;
      const el = stream.querySelector(`[data-message-id="${cssEscape(messageId)}"]`);
      if (!(el instanceof HTMLElement)) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(280, window.innerWidth - 16);
      const height = 44;
      let top = r.top - height - 8;
      if (top < 8) top = Math.min(r.bottom + 8, window.innerHeight - height - 8);
      let left = r.left + r.width / 2 - width / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      setBox({ top, left });
    };

    place();
    stream?.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    return () => {
      stream?.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
  }, [messageId, stream]);

  if (!box) return null;

  return (
    <div
      role="toolbar"
      aria-label="React to this message"
      style={{
        position: "fixed",
        top: box.top,
        left: box.left,
        zIndex: 20,
        display: "flex",
        gap: 4,
        padding: "6px 8px",
        borderRadius: 999,
        backgroundColor: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        boxShadow: "var(--shadow-high, var(--shadow-low))",
        maxWidth: "calc(100vw - 16px)",
        overflowX: "auto",
      }}
    >
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          aria-label={`React ${emoji}`}
          onClick={() => onPick(emoji)}
          style={{
            border: "none",
            background: "transparent",
            fontSize: "1.4em",
            lineHeight: 1,
            padding: "4px 6px",
            cursor: "pointer",
            borderRadius: 999,
          }}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
