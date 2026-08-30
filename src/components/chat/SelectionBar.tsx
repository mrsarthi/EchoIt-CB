/**
 * What you can do with the messages you have picked.
 *
 * Appears in place of the chat header while a selection is live, which is what
 * makes the mode obvious: the screen visibly changes rather than growing an
 * extra strip that is easy to miss and easy to leave switched on.
 *
 * ## Kept short on purpose
 *
 * Copy, forward, delete, and a way out. Every other action anyone has ever put
 * here — pin, star, report, info — is one more thing between a person and the
 * three they actually came for, and each is a thing to explain and maintain.
 * The user asked for it limited; this is that, with the one addition that
 * earns its place: **Select all**, because "forward the last few messages"
 * without it means tapping each one.
 */

import { Button } from "../ui/Button";
import { XIcon, CopyIcon, EyeOffIcon, ShareIcon } from "../ui/Icons";

export interface SelectionBarProps {
  count: number;
  onCancel: () => void;
  onCopy: () => void;
  onForward: () => void;
  onDelete: () => void;
  onSelectAll: () => void;
  /** False once everything is already picked, so the button is not a no-op. */
  canSelectAll: boolean;
}

export function SelectionBar({
  count,
  onCancel,
  onCopy,
  onForward,
  onDelete,
  onSelectAll,
  canSelectAll,
}: SelectionBarProps) {
  return (
    <div
      role="toolbar"
      aria-label={`${count} selected`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-sm)",
        padding: "var(--space-sm) var(--space-md)",
        backgroundColor: "var(--color-surface)",
        borderBottom: "1px solid var(--color-border)",
        // Wraps rather than overflowing: four controls plus a count is exactly
        // the row that runs off a narrow screen at a large system font.
        flexWrap: "wrap",
      }}
    >
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel selection"
        title="Cancel selection"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          borderRadius: "var(--radius-full)",
          background: "none",
          border: "none",
          color: "var(--color-text)",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        <XIcon size={20} />
      </button>

      <span
        aria-live="polite"
        style={{
          fontWeight: "var(--font-weight-semibold)",
          marginRight: "auto",
          whiteSpace: "nowrap",
        }}
      >
        {count} selected
      </span>

      {canSelectAll && (
        <Button variant="ghost" size="sm" onClick={onSelectAll}>
          Select all
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={onCopy}>
        <CopyIcon size={16} /> Copy
      </Button>
      <Button variant="ghost" size="sm" onClick={onForward}>
        <ShareIcon size={16} /> Forward
      </Button>
      {/*
        An eye-with-a-line, not a waste bin. The label says Delete because that
        is the word people look for, but the picture should not promise
        destruction that is not happening — the message stays on their device
        whatever this button is called. The confirmation says so in words.
      */}
      <Button variant="danger" size="sm" onClick={onDelete}>
        <EyeOffIcon size={16} /> Delete
      </Button>
    </div>
  );
}
