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

export function ReadStatus({ status, peerName, peerProfile, size = 16 }: ReadStatusProps) {
  const label = describeStatus(status, peerName);

  if (status === "sent") {
    return (
      <span
        title={label}
        aria-label={label}
        role="img"
        style={{
          width: size,
          height: size,
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
        <CheckIcon size={Math.round(size * 0.62)} />
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
        muted={status === "delivered"}
        ring={status === "read" ? "var(--color-success)" : undefined}
      />
    </span>
  );
}
