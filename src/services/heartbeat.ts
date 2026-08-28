/**
 * Telling paired peers we are still here, and noticing when they stop.
 *
 * The transport half of presence. `presence.ts` decides what the evidence
 * *means* and is deliberately pure; this is the part that touches the SDK.
 *
 * ## Why ephemeral rather than a message
 *
 * A heartbeat every thirty seconds sent with `sendMessage` would be roughly
 * 2,900 permanent CRDT entries per conversation per day, replicated to both
 * devices and written to disk, for a signal nobody ever reads back. Stream
 * `0x07` (`sendEphemeral`) is delivered now or not at all: not stored, not
 * queued, not retried, not replayed to someone who reconnects.
 *
 * ## Zero is normal
 *
 * `sendEphemeral` resolves with the number of peers it reached, and **0 means
 * nobody was connected** — not that anything failed. Treating 0 as an error
 * would light up the logs constantly, since the common case for a 1:1 messenger
 * is that the other person is not currently running the app.
 */

import type { EchoItClient } from "../transport/create-client";
import { channelIdFor } from "./conversation";
import { HEARTBEAT_INTERVAL_MS } from "./presence";
import { toMillis } from "./timestamps";

/*
 * The signals we put on stream 0x07.
 *
 * Opaque bytes as far as the protocol is concerned; the tag is ours. Two
 * different things share the stream, so each is matched exactly rather than by
 * prefix — a heartbeat must never be mistaken for typing, or a contact would
 * appear to be composing a message merely by having the app open.
 */
const HEARTBEAT = new TextEncoder().encode("echoit:hb:1");
const TYPING = new TextEncoder().encode("echoit:typing:1");

const matches = (payload: Uint8Array, signal: Uint8Array) =>
  payload.length === signal.length && signal.every((byte, i) => payload[i] === byte);

/** Recognise our own heartbeat and ignore anything else on the stream. */
export function isHeartbeat(payload: Uint8Array): boolean {
  return matches(payload, HEARTBEAT);
}

/** Recognise a typing signal. */
export function isTypingSignal(payload: Uint8Array): boolean {
  return matches(payload, TYPING);
}

/**
 * Heard-from and departed times per peer, as `presenceFrom` wants them.
 *
 * Kept as a plain object so React state updates are ordinary replacements.
 */
export interface PresenceEvidence {
  /** Unix ms of the last heartbeat or message from each peer. */
  heardAt: Record<string, number>;
  /** Unix ms of a disconnect we were actually told about. */
  departedAt: Record<string, number>;
  /** Unix ms of the last typing signal. Expires on its own; see services/typing. */
  typingAt: Record<string, number>;
}

export const emptyEvidence = (): PresenceEvidence => ({
  heardAt: {},
  departedAt: {},
  typingAt: {},
});

/**
 * Start heartbeating to `peerDids`, and report what comes back.
 *
 * `onEvidence` is called with a *new* object whenever something changes, so a
 * React setState can take it directly.
 *
 * @returns Stop everything. Safe to call twice.
 */
export function startPresence(
  client: EchoItClient,
  myDid: string,
  peerDids: string[],
  onEvidence: (update: (previous: PresenceEvidence) => PresenceEvidence) => void,
): () => void {
  const unsubscribes: Array<() => void> = [];
  let stopped = false;

  const heard = (peerDid: string, at: number) => {
    onEvidence((previous) => {
      // A fresh sighting clears an earlier departure; otherwise a peer who
      // left and came back would stay grey until the next disconnect.
      const departedAt = { ...previous.departedAt };
      delete departedAt[peerDid];
      return { ...previous, heardAt: { ...previous.heardAt, [peerDid]: at }, departedAt };
    });
  };

  for (const peerDid of peerDids) {
    const channelId = channelIdFor(myDid, peerDid);
    try {
      const off = client.client.chat.onEphemeral(channelId, (fromDid: string, payload: Uint8Array) => {
        if (fromDid === myDid) return;

        // Typing is also evidence of presence -- someone composing a message is
        // unambiguously there -- so it updates both.
        if (isTypingSignal(payload)) {
          const at = Date.now();
          heard(fromDid, at);
          onEvidence((previous) => ({
            ...previous,
            typingAt: { ...previous.typingAt, [fromDid]: at },
          }));
          return;
        }

        if (!isHeartbeat(payload)) return;
        heard(fromDid, Date.now());
      });
      if (typeof off === "function") unsubscribes.push(off);
    } catch {
      // A channel we cannot subscribe to simply yields no presence for that
      // peer, which reads as "unknown" — the honest outcome.
    }
  }

  /*
   * A disconnect is direct evidence of absence, where the window is only an
   * inference from silence. Recording it turns the dot off at once instead of
   * up to 75 seconds later.
   *
   * This event is the reason presence could not be built properly before
   * 0.7.1 — and it shipped broken in 0.7.0, firing only for the side that
   * called disconnect(). The remote peer, which is the entire point, was never
   * told over QUIC.
   */
  const departures = (client.client as unknown as {
    onPeerDisconnected?: { on: (event: string, fn: (e: { peerDid: string; at?: number }) => void) => (() => void) | void };
  }).onPeerDisconnected;

  if (departures?.on) {
    const off = departures.on("peer", ({ peerDid, at }) => {
      // `at` comes back in SECONDS, like message timestamps do. Left raw it is
      // ~1.79e9 against a heard-at of ~1.79e12, so it always looks older than
      // the last heartbeat and the departure is discarded — the dot stays green
      // for someone who has gone. Caught by the QUIC presence test.
      const departedAt = at === undefined ? Date.now() : toMillis(at);
      onEvidence((previous) => ({
        ...previous,
        departedAt: { ...previous.departedAt, [peerDid]: departedAt },
      }));
    });
    if (typeof off === "function") unsubscribes.push(off);
  }

  const beat = () => {
    if (stopped) return;
    for (const peerDid of peerDids) {
      const channelId = channelIdFor(myDid, peerDid);
      void Promise.resolve(client.client.chat.sendEphemeral(channelId, HEARTBEAT)).catch(() => {
        // Undeliverable is the ordinary case, not a fault: the peer is simply
        // not connected. Presence lapses on its own through the window.
      });
    }
  };

  beat();
  const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
    for (const off of unsubscribes) {
      try {
        off();
      } catch {
        // Tearing down is best effort; a listener that refuses to detach must
        // not prevent the rest from doing so.
      }
    }
  };
}

/**
 * Tell a peer we are composing a message.
 *
 * Ephemeral, so it is delivered now or not at all, and never written to the
 * conversation document. Zero peers reached is the ordinary case and not a
 * failure — it means they are not connected, and the indicator they would have
 * seen simply never appears.
 *
 * Throttling is the caller's job (`shouldSendTyping` in services/typing): this
 * is called from a keystroke handler, and one packet per character would be
 * both wasteful and a far more precise disclosure than intended.
 */
export async function sendTyping(
  client: EchoItClient,
  myDid: string,
  peerDid: string,
): Promise<void> {
  try {
    await client.client.chat.sendEphemeral(channelIdFor(myDid, peerDid), TYPING);
  } catch {
    // Undeliverable is ordinary. A typing indicator is the last thing that
    // should surface an error to anybody.
  }
}
