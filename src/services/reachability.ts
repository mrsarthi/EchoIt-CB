/**
 * Whether it is honest to hand a message to the network right now.
 *
 * ## The question the app was asking, and the one it should ask
 *
 * Sending asked "is there a connection?". The useful question is "is anyone
 * there?", and the two come apart for as long as it takes QUIC to notice a
 * peer has gone — which is tens of seconds, because nothing announces it. In
 * that window a write into a dead connection is accepted, `publish()` returns a
 * non-zero count, and the SDK's own outbox is never consulted, because from its
 * point of view the send worked.
 *
 * The SDK is explicit that this is the shape of the problem:
 *
 * > `isOnline()` is a prediction, and predictions about a network are wrong.
 *
 * Measured on two phones with SDK 0.8.0: of four messages sent to a phone
 * Android had frozen, three were reported sent and ceased to exist. The fourth
 * was sent late enough that the transport had finally noticed, so it queued and
 * arrived. The difference between the three and the one is nothing but elapsed
 * time.
 *
 * ## Evidence, not prediction
 *
 * Presence already collects the only evidence that means anything: the last
 * time something actually arrived from that peer. A heartbeat every
 * `HEARTBEAT_INTERVAL_MS`, and any message or receipt counts too. If that
 * evidence is fresh, sending is reasonable. If it is stale, the connection may
 * look alive and is not worth trusting with something that would be lost.
 *
 * Note what this does **not** claim. It does not know they will receive it —
 * nothing can. It distinguishes "we have heard from them within living memory"
 * from "we have not", which is the distinction the send path was missing
 * entirely.
 */

// Explicit extension: this file is compiled as Node code by the harness, where
// `node16` resolution requires one. Vite resolves it to the .ts either way.
import { ONLINE_WINDOW_MS } from "./presence.js";

/**
 * Long enough to be sure, not so long that a brief lull queues everything.
 *
 * Deliberately the same window presence uses to light the dot, so a contact
 * shown as online is exactly a contact this will send to. Two indicators
 * disagreeing about whether someone is there would be worse than either alone:
 * a green dot beside a message that says "waiting" reads as a bug.
 */
export const REACHABLE_WINDOW_MS = ONLINE_WINDOW_MS;

/**
 * Whether we have heard from this peer recently enough to send now.
 *
 * @param heardAt Unix ms of the last thing that arrived from them, if any.
 * @param now Unix ms.
 */
export function isReachable(heardAt: number | undefined, now: number): boolean {
  if (heardAt === undefined) return false;
  // A timestamp in the future is a clock that moved, not evidence of presence.
  // Treating it as fresh would keep a peer permanently sendable.
  if (heardAt > now) return false;
  return now - heardAt < REACHABLE_WINDOW_MS;
}

/** Why a message is waiting, in words a person can act on. */
export function describeWaiting(heardAt: number | undefined, now: number): string {
  if (heardAt === undefined) {
    return "Waiting until they are online — nothing has arrived from them yet.";
  }
  const minutes = Math.floor((now - heardAt) / 60_000);
  if (minutes < 1) return "Waiting until they are online.";
  if (minutes < 60) {
    return `Waiting until they are online — last heard from ${minutes} minute${minutes === 1 ? "" : "s"} ago.`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `Waiting until they are online — last heard from ${hours} hour${hours === 1 ? "" : "s"} ago.`;
  }
  const days = Math.floor(hours / 24);
  return `Waiting until they are online — last heard from ${days} day${days === 1 ? "" : "s"} ago.`;
}
