/**
 * "3 new messages" — a way back down, when the newest one arrived off screen.
 *
 * ## Why this has to exist separately from the nav badge
 *
 * The conversation deliberately does not follow you down while you are reading
 * older messages; being yanked to the bottom mid-sentence is worse than
 * missing the arrival. But the consequence is that the arrival is *silent* —
 * it lands below the fold and nothing says so. On a phone the nav, and its
 * badge, are not on screen at all while a conversation is open, so there is no
 * other surface that could tell you.
 *
 * ## Not a toast
 *
 * It stays until it is dealt with, either by pressing it or by scrolling to
 * the end yourself. Something that announces a message and then disappears on
 * a timer is worse than nothing: it converts "you did not know" into "you
 * might have known if you had been looking", which is harder to notice and
 * impossible to recover.
 */

import { ArrowLeftIcon } from "../ui/Icons";

export interface NewMessagePillProps {
  count: number;
  onClick: () => void;
}

export function NewMessagePill({ count, onClick }: NewMessagePillProps) {
  if (count <= 0) return null;

  const label = count === 1 ? "1 new message" : `${count} new messages`;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}. Go to the newest.`}
      style={{
        // Floats over the stream rather than taking a row in it: inserting an
        // element into the list would shift every message under the reader at
        // the exact moment they are trying to read one.
        position: "absolute",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: "var(--space-md)",
        zIndex: 5,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 14px",
        borderRadius: "var(--radius-full)",
        border: "none",
        backgroundColor: "var(--color-primary)",
        color: "var(--color-on-primary, #fff)",
        font: "inherit",
        fontSize: "var(--font-size-body-sm)",
        fontWeight: "var(--font-weight-semibold)",
        cursor: "pointer",
        boxShadow: "0 2px 8px rgba(0,0,0,0.28)",
        // Never wider than the conversation, whatever the system font.
        maxWidth: "calc(100% - var(--space-lg) * 2)",
      }}
    >
      {/* Rotated a quarter turn: down is where it takes you. */}
      <ArrowLeftIcon size={14} style={{ transform: "rotate(-90deg)" }} />
      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </span>
    </button>
  );
}
