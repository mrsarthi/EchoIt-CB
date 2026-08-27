/**
 * Who is around, and when they were last here.
 *
 * Deliberately free of SDK and React imports so it can be tested without a
 * network or a device — the same reason `timestamps.ts` is separate.
 *
 * ## What this can and cannot know
 *
 * WhatsApp knows you are online because your phone holds a connection to their
 * server and heartbeats over it. There is no server here, and the SDK exposes
 * `onPeerConnected` but **no `onPeerDisconnected`** — a flag driven by that
 * alone would switch on and never switch off, showing "online" for someone who
 * left hours ago. That is the Finding 17 mistake: asserting a state from a
 * signal that does not carry it.
 *
 * So "online" here means *we have heard from this peer within
 * `ONLINE_WINDOW_MS`* — inbound traffic, which is evidence they were running
 * the app moments ago. It is honest but conservative: a peer who is online and
 * simply not typing falls back to "last seen" once the window lapses.
 *
 * Closing that gap needs an **ephemeral presence ping** in the protocol — a
 * message that is delivered but not written into the CRDT document. Doing it
 * with ordinary messages would grow the document forever: a ping every 30
 * seconds is roughly 2,900 permanent entries per conversation per day, stored
 * on both devices. See PROGRESS.md for the API this needs.
 */

/**
 * How recently we must have heard from a peer to call them online.
 *
 * Two minutes rather than thirty seconds because inbound traffic is currently
 * only real messages. A shorter window would make the indicator flicker off
 * mid-conversation, which reads as a bug. Revisit once presence pings exist.
 */
export const ONLINE_WINDOW_MS = 2 * 60 * 1000;

export type PresenceState = "online" | "offline" | "unknown";

export interface Presence {
  state: PresenceState;
  /** Unix ms of the last evidence they were there, when there is any. */
  lastSeen?: number;
}

/**
 * Work out a peer's presence from the last time we heard from them.
 *
 * `unknown` is a distinct state from `offline` on purpose: never having heard
 * from someone is different from knowing they left, and showing "last seen
 * 56 years ago" for a brand new contact is what conflating them produces.
 */
export function presenceFrom(lastInboundAt: number | undefined, now: number): Presence {
  if (!lastInboundAt) return { state: "unknown" };
  if (now - lastInboundAt <= ONLINE_WINDOW_MS) return { state: "online", lastSeen: lastInboundAt };
  return { state: "offline", lastSeen: lastInboundAt };
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Phrase a presence for the line under someone's name.
 *
 * Returns an empty string for `unknown` rather than a placeholder: an empty
 * slot says nothing, where "last seen unknown" says something false-sounding
 * about a contact who simply has not written yet.
 */
export function describePresence(presence: Presence, now: number): string {
  if (presence.state === "unknown" || presence.lastSeen === undefined) return "";
  if (presence.state === "online") return "Online";

  const elapsed = now - presence.lastSeen;
  if (elapsed < MINUTE) return "last seen just now";
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    return `last seen ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return `last seen ${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const days = Math.floor(elapsed / DAY);
  if (days === 1) {
    // A time is more use than "1 day ago" once it is yesterday.
    const at = new Date(presence.lastSeen).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `last seen yesterday at ${at}`;
  }
  if (days < 7) return `last seen ${days} days ago`;

  // Beyond a week the date carries more than a count of days. No timezone is
  // named, so each reader sees it in their own -- see timestamps.ts.
  const on = new Date(presence.lastSeen).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
  return `last seen ${on}`;
}
