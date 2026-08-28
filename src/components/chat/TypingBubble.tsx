/**
 * The three dots at the end of a conversation while the other person types.
 *
 * A line in the header saying "typing…" was the first attempt and was reported
 * as missing: it is small, it sits where presence normally sits, and it is easy
 * to read past. The bubble is where a message is about to appear, which is
 * where attention already is — which is why both reference apps put it there.
 *
 * Shaped like an incoming bubble on purpose: same corner radii, same surface,
 * same alignment. It reads as "a message is coming" rather than as a status
 * line that happens to be down there.
 *
 * The dots animate through a shared keyframe defined in index.css, and stop
 * entirely under `prefers-reduced-motion` — a permanently animating element is
 * exactly what that setting exists to switch off.
 */

interface TypingBubbleProps {
  /** Shown to screen readers, which get no benefit from the animation. */
  peerName: string;
}

export function TypingBubble({ peerName }: TypingBubbleProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        maxWidth: "100%",
      }}
      // `polite` rather than `assertive`: someone starting to type should not
      // interrupt whatever a screen reader is in the middle of saying.
      aria-live="polite"
      aria-label={`${peerName} is typing`}
    >
      <div
        style={{
          padding: "12px 16px",
          borderRadius: "16px 16px 16px 4px",
          backgroundColor: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          boxShadow: "var(--shadow-low)",
          display: "flex",
          alignItems: "center",
          gap: 5,
          // Tight to the dots; a full-width bubble would read as an empty
          // message rather than an ellipsis.
          width: "fit-content",
        }}
      >
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            aria-hidden="true"
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              backgroundColor: "var(--color-text-muted)",
              animation: "echoit-typing-dot 1.2s infinite ease-in-out",
              // Staggered, so the three read as a wave rather than a pulse.
              animationDelay: `${index * 0.18}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
