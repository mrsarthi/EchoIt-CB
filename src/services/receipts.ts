/**
 * Whether what you sent arrived, and whether they looked at it.
 *
 * ## Watermarks, not per-message acknowledgements
 *
 * A receipt names a *time*, not a message: "everything of yours up to T has
 * reached me", and separately "up to T I have read". One number per peer per
 * kind covers a conversation of any length, is idempotent, and repairs itself
 * — a receipt that goes missing costs nothing, because the next one supersedes
 * it. Per-message acknowledgements would need one signal per message in each
 * direction and would leave permanent gaps wherever one was lost.
 *
 * ## Why they ride the ephemeral stream, and what that costs
 *
 * Stream `0x07` is delivered now or not at all: nothing stored, queued or
 * replayed. That is right for a receipt — a signal about the past has no value
 * arriving late into a CRDT that would keep it forever — but it means a
 * receipt sent while you are offline is simply lost, and the tick beside your
 * message would stay wrong indefinitely.
 *
 * So watermarks are **re-sent on connecting**, not only when they change.
 * Re-sending is free precisely because they are watermarks: the same number
 * twice means the same thing, and a higher one supersedes without ordering
 * problems. This is what makes the status eventually right rather than right
 * only if both people happened to be online at the same instant.
 *
 * ## What each state actually claims
 *
 * - **sent** — it is in the conversation. Nothing says it left this device.
 * - **delivered** — their device has it. Not that they are holding the phone.
 * - **read** — they had the conversation open with this message in it.
 *
 * Read implies delivered, and the ordering is enforced here rather than
 * trusted: a peer that reports a read watermark ahead of its delivered one
 * (an older build, a bug, a modified client) must not make a message look
 * read-but-not-delivered, which is a state that means nothing.
 */

/** How far a peer has confirmed, in Unix ms. Absent means nothing confirmed. */
export interface Watermarks {
  /** Their device holds everything of ours up to and including this time. */
  readonly deliveredUpTo?: number;
  /** They have read everything of ours up to and including this time. */
  readonly readUpTo?: number;
}

/** The three states shown against an outgoing message. */
export type MessageStatus = "sent" | "delivered" | "read";

const PREFIX = "echoit:rcpt:1:";
const DELIVERED = "d";
const READ = "r";

export type ReceiptKind = "delivered" | "read";

export interface Receipt {
  readonly kind: ReceiptKind;
  /** Unix ms. */
  readonly upTo: number;
}

/** Encode a watermark for stream `0x07`. */
export function encodeReceipt(receipt: Receipt): Uint8Array {
  const tag = receipt.kind === "read" ? READ : DELIVERED;
  return new TextEncoder().encode(`${PREFIX}${tag}:${Math.floor(receipt.upTo)}`);
}

/**
 * Recognise one of our receipts, or return undefined.
 *
 * Undefined for anything else on the stream — heartbeats and typing share it,
 * and a heartbeat misread as a receipt would mark a conversation read the
 * moment the other person opened the app.
 */
export function decodeReceipt(payload: Uint8Array): Receipt | undefined {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
  } catch {
    return undefined;
  }
  if (!text.startsWith(PREFIX)) return undefined;

  const rest = text.slice(PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator < 0) return undefined;

  const tag = rest.slice(0, separator);
  if (tag !== DELIVERED && tag !== READ) return undefined;

  const digits = rest.slice(separator + 1);
  // Parsed strictly: `Number("12abc")` is NaN but `parseInt` is 12, and a
  // watermark half-read from a corrupt frame must be rejected, not truncated.
  if (!/^\d+$/.test(digits)) return undefined;

  const upTo = Number(digits);
  if (!Number.isFinite(upTo)) return undefined;

  return { kind: tag === READ ? "read" : "delivered", upTo };
}

/**
 * Fold a receipt into what we already hold.
 *
 * Watermarks only ever move forward. An older one arriving late — reordered on
 * the wire, or replayed on reconnect after a newer one — must not walk the
 * status backwards from read to delivered, which on screen looks like the
 * message being unread again.
 */
export function applyReceipt(current: Watermarks, receipt: Receipt): Watermarks {
  if (receipt.kind === "read") {
    return {
      ...current,
      readUpTo: Math.max(current.readUpTo ?? 0, receipt.upTo),
    };
  }
  return {
    ...current,
    deliveredUpTo: Math.max(current.deliveredUpTo ?? 0, receipt.upTo),
  };
}

/**
 * What to show beside one outgoing message.
 *
 * `sentAt` is the message's own timestamp. Incoming messages have no status —
 * a tick against something someone else wrote is meaningless — so callers
 * should not ask, and this answers for the outgoing case only.
 */
export function statusFor(sentAt: number, marks: Watermarks | undefined): MessageStatus {
  if (!marks) return "sent";

  // Read implies delivered. See the note at the top for why this is enforced
  // rather than assumed of the sender.
  const delivered = Math.max(marks.deliveredUpTo ?? 0, marks.readUpTo ?? 0);

  if ((marks.readUpTo ?? 0) >= sentAt) return "read";
  if (delivered >= sentAt) return "delivered";
  return "sent";
}

/** What the status means, for a tooltip and for a screen reader. */
export function describeStatus(status: MessageStatus, peerName: string): string {
  switch (status) {
    case "read":
      return `Read by ${peerName}`;
    case "delivered":
      return `Delivered to ${peerName}'s device`;
    default:
      return "Sent";
  }
}
