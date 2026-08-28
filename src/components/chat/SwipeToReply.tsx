/**
 * Swipe a message to the right to reply to it.
 *
 * Wraps one message row. The row follows the finger a little way, a reply arrow
 * fades in behind it, and past a threshold the message joins the reply chain.
 *
 * ## Why the gesture is constrained
 *
 * The message list scrolls vertically and the viewer pages horizontally, so a
 * loose horizontal gesture would fight both. This claims a drag only once it is
 * clearly sideways — more horizontal than vertical, and past a few pixels — and
 * otherwise leaves the touch alone for the list to scroll with.
 *
 * ## Why it does not use touch-action
 *
 * `touch-action: pan-y` on the row would tell the browser to keep vertical
 * scrolling and drop horizontal panning, which is close to what is wanted. But
 * the app sets `pan-x pan-y` on `body` to stop pinch-zoom, and effective
 * touch-action is the intersection down the ancestor chain — a descendant
 * cannot re-enable what an ancestor removed. So the decision is made in the
 * handler instead, where it is at least visible.
 */

import { useRef, useState } from "react";

import { ArrowLeftIcon } from "../ui/Icons";

/** How far the row must travel before the swipe counts. */
const TRIGGER_PX = 56;

/** How far it is allowed to travel, so it reads as a hint rather than a drawer. */
const MAX_PX = 80;

interface SwipeToReplyProps {
  onReply: () => void;
  /** Already in the chain — shown held open so the state is visible at rest. */
  selected?: boolean;
  children: React.ReactNode;
}

export function SwipeToReply({ onReply, selected = false, children }: SwipeToReplyProps) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const claimed = useRef(false);

  const onTouchStart = (e: React.TouchEvent) => {
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    claimed.current = false;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!start.current) return;
    const dx = e.touches[0].clientX - start.current.x;
    const dy = e.touches[0].clientY - start.current.y;

    // Decide once, then stick with it. Re-deciding mid-gesture makes a diagonal
    // drag flicker between scrolling and swiping.
    if (!claimed.current) {
      if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < 8) return;
      claimed.current = true;
      setDragging(true);
    }

    // Rightwards only. Left is unclaimed, so a future action can use it.
    setOffset(Math.max(0, Math.min(MAX_PX, dx)));
  };

  const onTouchEnd = () => {
    if (claimed.current && offset >= TRIGGER_PX) onReply();
    start.current = null;
    claimed.current = false;
    setDragging(false);
    setOffset(0);
  };

  const resting = selected ? 18 : 0;
  const shown = dragging ? offset : resting;

  return (
    <div style={{ position: "relative", width: "100%" }}>
      {/*
        The arrow sits behind the row and is revealed by the drag, rather than
        pushed along by it — so the hint appears exactly as far as the finger
        has travelled and disappears with it.
      */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 8,
          top: 0,
          bottom: 0,
          display: "flex",
          alignItems: "center",
          // Fades in across the first half of the travel, so the gesture
          // signals what it will do before it does it.
          opacity: Math.min(1, shown / TRIGGER_PX),
          color: shown >= TRIGGER_PX || selected ? "var(--color-primary)" : "var(--color-text-muted)",
          pointerEvents: "none",
          transform: "scaleX(-1)",
        }}
      >
        <ArrowLeftIcon size={18} />
      </div>

      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{
          transform: `translateX(${shown}px)`,
          // No transition while the finger is down, or the row lags behind it.
          transition: dragging ? "none" : "transform 160ms ease-out",
        }}
      >
        {children}
      </div>
    </div>
  );
}
