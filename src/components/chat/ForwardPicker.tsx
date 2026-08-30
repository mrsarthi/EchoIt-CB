/**
 * Choose who to forward to — several at once.
 *
 * ## Why multi-select rather than one at a time
 *
 * Forwarding the same thing to four people by repeating a one-at-a-time flow
 * four times is the same work done four times, and each repetition is another
 * chance to send it to the wrong person. The user asked for several at once.
 *
 * ## Send is disabled rather than hidden until someone is picked
 *
 * A button that appears when a condition is met moves the layout under the
 * finger at the moment someone is reaching for it. Disabled and visible keeps
 * the target still.
 */

import { useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Avatar } from "../profile/Avatar";
import type { PeerProfile } from "../../services/profile-format";

export interface ForwardTarget {
  peerDid: string;
  name: string;
  profile?: PeerProfile;
}

export interface ForwardPickerProps {
  isOpen: boolean;
  onClose: () => void;
  targets: readonly ForwardTarget[];
  /** How many messages are being forwarded, for the button. */
  count: number;
  onSend: (peerDids: readonly string[]) => void;
}

export function ForwardPicker({ isOpen, onClose, targets, count, onSend }: ForwardPickerProps) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (peerDid: string) => {
    setPicked((previous) => {
      const next = new Set(previous);
      if (next.has(peerDid)) next.delete(peerDid);
      else next.add(peerDid);
      return next;
    });
  };

  const close = () => {
    setPicked(new Set());
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={count === 1 ? "Forward this message" : `Forward ${count} messages`}
      footer={
        <div style={{ display: "flex", gap: "var(--space-sm)", justifyContent: "flex-end", flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button
            disabled={picked.size === 0}
            onClick={() => {
              onSend([...picked]);
              setPicked(new Set());
              onClose();
            }}
          >
            {picked.size === 0
              ? "Send"
              : `Send to ${picked.size} ${picked.size === 1 ? "person" : "people"}`}
          </Button>
        </div>
      }
    >
      {targets.length === 0 ? (
        <p style={{ margin: 0, color: "var(--color-text-muted)" }}>
          You have nobody else to forward to yet.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {targets.map((target) => (
            <label
              key={target.peerDid}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-sm)",
                padding: "var(--space-sm)",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
                // A whole-row target: a checkbox alone is a poor thing to hit
                // on a phone.
                minHeight: 44,
              }}
            >
              <input
                type="checkbox"
                checked={picked.has(target.peerDid)}
                onChange={() => toggle(target.peerDid)}
                style={{ flexShrink: 0 }}
              />
              <Avatar profile={target.profile} name={target.name} size={32} />
              <span style={{ overflowWrap: "anywhere" }}>{target.name}</span>
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}
