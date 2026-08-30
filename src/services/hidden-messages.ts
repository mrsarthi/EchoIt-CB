/**
 * Hiding a message on this device, and being straight about what that is not.
 *
 * ## Why there is no "delete for everyone"
 *
 * A conversation is a CRDT replicated to both devices. Its whole purpose is
 * that a change survives being offline, arriving late, and arriving twice —
 * which is the same as saying it cannot be taken back. There is no operation
 * that removes an entry from the other person's replica, and an app that
 * offered one would be making a promise the storage cannot keep. Worse, it
 * would be the *reassuring* kind of lie: someone deletes a message believing
 * it is gone, and it is sitting on a device they will never see again.
 *
 * So the only honest operation is local, it is named for what it does, and
 * `DELETE_WARNING` is shown before it happens rather than buried in a help
 * page. The user asked for exactly this: delete for me, and tell them their
 * message can never be completely deleted.
 *
 * ## Hidden, not removed
 *
 * The message stays in the document; a list of hidden ids is kept beside it.
 * Removing it from the replica is not something a peer can do to its own copy
 * without the two documents diverging, and a divergent replica resyncs — so a
 * message deleted from the store would come back on the next sync, which
 * reads as the app being broken.
 */

const KEY_PREFIX = "echoit:hidden:";

/** Ids hidden on this device, per conversation. */
export type HiddenIds = ReadonlySet<string>;

/** What a person is told before a message is hidden. Shown, not buried. */
export const DELETE_WARNING =
  "This removes the message from this device only. It stays on the other "
  + "person's device, and nothing you send can ever be fully unsent.";

function keyFor(myDid: string | null, peerDid: string): string {
  return `${KEY_PREFIX}${(myDid ?? "global").slice(0, 24)}:${peerDid.slice(-12)}`;
}

export function loadHidden(myDid: string | null, peerDid: string): Set<string> {
  try {
    const raw = localStorage.getItem(keyFor(myDid, peerDid));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    // A corrupt entry costs one message's hidden state, not the whole set.
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveHidden(myDid: string | null, peerDid: string, ids: HiddenIds): void {
  try {
    localStorage.setItem(keyFor(myDid, peerDid), JSON.stringify([...ids]));
  } catch {
    // Not silent: a failed write means the message reappears on next launch,
    // which reads as the delete having been ignored.
    console.error("EchoIt: could not persist hidden messages to local storage");
  }
}

/** Everything not hidden, in the order it was given. */
export function visibleMessages<T extends { id: string }>(
  messages: readonly T[],
  hidden: HiddenIds,
): T[] {
  return hidden.size === 0 ? [...messages] : messages.filter((m) => !hidden.has(m.id));
}

/** What to say on the confirm button, given how many are selected. */
export function describeDelete(count: number): string {
  return count === 1
    ? "Delete this message for me"
    : `Delete ${count} messages for me`;
}

/**
 * Assemble text for forwarding or copying.
 *
 * One message forwards as itself: quoting a single line with an attribution
 * turns a normal-looking message into an obviously-forwarded one for no gain.
 * Several are joined with blank lines so they arrive readable rather than as
 * one run-on paragraph.
 */
export function joinForForward(texts: readonly string[]): string {
  return texts.map((t) => t.trim()).filter(Boolean).join("\n\n");
}
