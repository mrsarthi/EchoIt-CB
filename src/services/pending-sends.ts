/**
 * Messages written while the other person was not there.
 *
 * ## Why the app holds these rather than the SDK
 *
 * The SDK has an outbox and it works, but it is only reached when `publish()`
 * reports zero recipients. During the window where a dead connection still
 * accepts writes, publish reports success and the outbox is never involved —
 * see `reachability.ts` for the measurement. So the decision not to publish has
 * to happen one layer up, before `sendMessage` is called at all, and something
 * has to hold the message meanwhile.
 *
 * ## Why they are not written to the conversation first
 *
 * The tempting shortcut is to let the SDK record it locally and simply not
 * deliver. That puts an undelivered message into the CRDT, where it is
 * indistinguishable from a delivered one — and the measurement showed such
 * messages do not reach the far side even after both devices reconnect and
 * sync. It would look filed and be lost.
 *
 * Holding it outside the document keeps the two states distinguishable: a
 * pending message is visibly waiting, and becomes an ordinary message at the
 * moment it is really sent, with `sendMessage` doing exactly what it always
 * does.
 *
 * ## They survive being killed
 *
 * The whole point is the case where the other person is away for a while, which
 * is also long enough for Android to kill the app. A queue that lived in memory
 * would lose precisely the messages it exists to protect.
 */

/** A message written but deliberately not yet handed to the network. */
export interface PendingSend {
  /** Local id, distinct from the SDK message id it will get when sent. */
  readonly id: string;
  readonly peerDid: string;
  readonly text: string;
  readonly replyTo?: readonly string[];
  /** Attachment handles. The blobs are already stored locally. */
  readonly attachments?: readonly { hash: string; size: number; mime: string; name?: string }[];
  /** Unix ms when the person pressed send. */
  readonly queuedAt: number;
}

const KEY_PREFIX = "echoit:pending-sends:";

function keyFor(myDid: string | null): string {
  return `${KEY_PREFIX}${myDid ? myDid.slice(0, 24) : "global"}`;
}

export function loadPending(myDid: string | null): PendingSend[] {
  try {
    const raw = localStorage.getItem(keyFor(myDid));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // A corrupt entry costs one message, not the queue.
    return parsed.filter(
      (x): x is PendingSend =>
        !!x && typeof x === "object"
        && typeof (x as PendingSend).id === "string"
        && typeof (x as PendingSend).peerDid === "string"
        && typeof (x as PendingSend).text === "string"
        && typeof (x as PendingSend).queuedAt === "number",
    );
  } catch {
    return [];
  }
}

export function savePending(myDid: string | null, pending: readonly PendingSend[]): void {
  try {
    localStorage.setItem(keyFor(myDid), JSON.stringify(pending));
  } catch {
    // Not silent. A failed write means a message the person believes is
    // waiting is gone at the next launch — the exact failure this exists to
    // prevent, arriving by a different route.
    console.error("EchoIt: could not persist pending messages to local storage");
  }
}

/** Everything waiting for one peer, oldest first. */
export function pendingFor(
  pending: readonly PendingSend[],
  peerDid: string,
): PendingSend[] {
  return pending
    .filter((p) => p.peerDid === peerDid)
    .sort((a, b) => a.queuedAt - b.queuedAt);
}

/** Add one, keeping the queue in the order it was written. */
export function enqueue(
  pending: readonly PendingSend[],
  entry: PendingSend,
): PendingSend[] {
  return [...pending, entry];
}

/**
 * Drop the ones that were sent.
 *
 * By id rather than by count: a flush can be interrupted part way, and
 * removing "the first n" after a partial send would discard messages that were
 * never delivered.
 */
export function remove(
  pending: readonly PendingSend[],
  ids: readonly string[],
): PendingSend[] {
  if (ids.length === 0) return [...pending];
  const drop = new Set(ids);
  return pending.filter((p) => !drop.has(p.id));
}

/**
 * A local id for something not yet on the wire.
 *
 * Prefixed so it can never be mistaken for an SDK message id in a list that
 * holds both, and unique enough that two messages written in the same
 * millisecond do not collide.
 */
export function pendingId(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return `pending:${random}`;
}

/** Whether an id came from this queue rather than from the SDK. */
export function isPendingId(id: string): boolean {
  return id.startsWith("pending:");
}
