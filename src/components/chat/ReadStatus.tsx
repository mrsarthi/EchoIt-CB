/**
 * Whether they got it, and whether they read it — shown as their own face.
 *
 * Three states, each a different amount of certainty, and the picture is what
 * carries the difference:
 *
 *   sent       a grey circle with a tick. We have it; nothing more is claimed.
 *   delivered  their picture, drained of colour. Their device holds it.
 *   read       their picture in colour. They had it on screen.
 *
 * ## Why colour is not the only signal
 *
 * Grey-to-colour is invisible to a good number of people, and a black and
 * white photograph is a perfectly ordinary thing for someone to choose as
 * their picture — so the difference between delivered and read cannot rest on
 * saturation alone. Read adds a ring; and every state carries a `title` and an
 * accessible label saying which it is in words.
 */

import { Avatar } from "../profile/Avatar";
import { describeStatus, type MessageStatus } from "../../services/receipts";
import type { PeerProfile } from "../../services/profile-format";
import { CheckIcon } from "../ui/Icons";

export interface ReadStatusProps {
  status: MessageStatus;
  peerName: string;
  peerProfile?: PeerProfile;
  size?: number;
}

/**
 * One line of text tall, whatever that turns out to be.
 *
 * 16px was reported as too big and measuring agreed: it sat in an 18px row of
 * 12px text, and the read ring took it to 24px — wider than the row. A fixed
 * 12px fixed that at the default and broke it elsewhere, because Android
 * scales CSS px for text and not for boxes: at system font 1.5 the label was
 * 18px and the circle still 12. `1em` is the size that is right at both ends,
 * and it is what "matches the timestamp" actually means.
 */
const DEFAULT_SIZE = 1;

export function ReadStatus({ status, peerName, peerProfile, size = DEFAULT_SIZE }: ReadStatusProps) {
  const label = describeStatus(status, peerName);

  if (status === "sent") {
    return (
      <span
        title={label}
        aria-label={label}
        role="img"
        style={{
          width: `${size}em`,
          height: `${size}em`,
          borderRadius: "50%",
          backgroundColor: "var(--color-surface-dim)",
          border: "1px solid var(--color-border)",
          color: "var(--color-text-muted)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          boxSizing: "border-box",
        }}
      >
        {/* The tick is drawn in px; 62% of a 12px line, which is where it was
            already, and it is a glyph rather than a box so it reads the same
            at larger sizes. */}
        <CheckIcon size={8} />
      </span>
    );
  }

  return (
    <span
      title={label}
      aria-label={label}
      role="img"
      style={{ display: "inline-flex", flexShrink: 0 }}
    >
      <Avatar
        profile={peerProfile}
        name={peerName}
        size={size}
        unit="em"
        muted={status === "delivered"}
        ring={status === "read" ? "var(--color-success)" : undefined}
      />
    </span>
  );
}
