/**
 * Who is around, and when they were last here.
 *
 * Deliberately free of SDK and React imports so it can be tested without a
 * network or a device — the same reason `timestamps.ts` is separate.
 *
 * ## What this can and cannot know
 *
 * WhatsApp knows you are online because your phone holds a connection to their
 * server and heartbeats over it. There is no server here.
 *
 * The first version of this inferred presence from inbound *messages*, because
 * the SDK then exposed `onPeerConnected` and no way to learn that someone had
 * left — a flag driven by connection alone switches on and never off, showing
 * "online" for someone who closed the app hours ago. That is the Finding 17
 * mistake: asserting a state from a signal that does not carry it.
 *
 * SDK 0.7.1 supplies both halves, so the evidence is now real:
 *
 *  - **an ephemeral heartbeat** (`chat.sendEphemeral`, stream `0x07`) every
 *    `HEARTBEAT_INTERVAL_MS`, delivered now or not at all — never written to
 *    the CRDT. Doing this with ordinary messages would add roughly 2,900
 *    permanent entries per conversation per day, on both devices.
 *  - **`onPeerDisconnected`**, which turns the dot off at once rather than
 *    waiting for the window to lapse.
 *
 * Heartbeats are primary and the disconnect event is an accelerator, per the
 * protocol's own guidance: a peer can be connected and idle, and a dropped
 * connection can take time to notice. Absence of a recent heartbeat fails in
 * the safe direction — someone present may briefly read as away, but someone
 * gone never reads as present.
 *
 * A caveat worth keeping: `sendEphemeral` returning 0 is **normal**. It means
 * nobody was connected, not that anything failed.
 */

/**
 * How often we tell paired peers we are still here.
 *
 * Ephemeral, so this costs nothing on disk. Thirty seconds is frequent enough
 * that the window below can be short without flickering, and rare enough that
 * it is not meaningful traffic.
 */
export const HEARTBEAT_INTERVAL_MS = 30 * 1000;

/**
 * How recently we must have heard from a peer to call them online.
 *
 * Two and a half missed heartbeats. One dropped beat — a moment of packet loss,
 * a device briefly busy — must not blink the dot off, because a flickering
 * indicator reads as a bug and teaches people to ignore it.
 *
 * This was two minutes when the only evidence was real messages arriving; that
 * had to be long enough to span someone reading rather than typing. Heartbeats
 * make it honest to be much stricter.
 */
export const ONLINE_WINDOW_MS = 75 * 1000;

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
 *
 * `departedAt` is a disconnect we were actually told about. It wins over the
 * window even when a heartbeat arrived seconds ago, because it is direct
 * evidence of absence where the window is only an inference from silence.
 */
export function presenceFrom(
  lastHeardAt: number | undefined,
  now: number,
  departedAt?: number,
): Presence {
  if (departedAt !== undefined && (lastHeardAt === undefined || departedAt >= lastHeardAt)) {
    return { state: "offline", lastSeen: lastHeardAt ?? departedAt };
  }
  if (!lastHeardAt) return { state: "unknown" };
  if (now - lastHeardAt <= ONLINE_WINDOW_MS) return { state: "online", lastSeen: lastHeardAt };
  return { state: "offline", lastSeen: lastHeardAt };
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
