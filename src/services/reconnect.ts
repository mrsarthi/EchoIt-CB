/**
 * Re-dialling known contacts on launch and on resume.
 *
 * ## Why this exists
 *
 * The SDK flushes its outbox from `drainAfterReconnect()`, which runs when a
 * connection is established — in either direction. Everything else is already
 * in place: queued messages persist across process death, they rehydrate at
 * boot, and a reconnection flushes them.
 *
 * But nothing was ever calling `connect()` a second time. The app dialled once,
 * during pairing, and never again. So the reconnection event the flush depends
 * on never happened, and queued messages sat there **even with both devices
 * awake and reachable**. This module supplies the missing event.
 *
 * ## Why addresses are refreshed first
 *
 * A ticket embeds the direct socket addresses a peer had when it was created.
 * Those go stale — a phone changes network, a NAT rebinds — and a dial to a
 * dead address fails in a way that looks like the network being down. Refresh
 * once per sweep, before any dialling.
 *
 * ## Why failures are swallowed per contact
 *
 * A contact who is genuinely offline *should* fail to dial. That is not an
 * error condition, it is the normal case, and it must not prevent the other
 * contacts from being tried or surface as an app error.
 */

import type { EchoItClient } from '../transport/create-client';
import { openConversation } from "./conversation";
import { parseAndValidateTicket, type Contact } from './pairing-store';

/**
 * Dials attempted in this process, by peer DID.
 *
 * Resume fires more often than people think — every task-switch, every
 * notification shade. Without this, a sweep would run on each one and churn
 * connections that are already healthy.
 */
const lastAttempt = new Map<string, number>();

/** How long to leave a peer alone after dialling it. */
const COOLDOWN_MS = 30_000;

export interface ReconnectResult {
  attempted: number;
  connected: number;
  failed: number;
  skipped: number;
}

export async function reconnectKnownContacts(
  client: EchoItClient,
  contacts: readonly Contact[],
  blockedDids: ReadonlySet<string>,
  myDid: string | null,
  now: number = Date.now(),
  /**
   * Dial even if this peer was tried inside the cooldown.
   *
   * The cooldown stops a resume storm from dialling the same peer repeatedly.
   * It is wrong for the case it was never designed for: a connection the SDK
   * still believes in because the webview was suspended when it closed, and
   * which therefore never gets re-established. Liveness is read from the
   * transport's `ConnectionState`, and a transport nobody was running to
   * observe never marked it closed.
   */
  force: boolean = false,
): Promise<ReconnectResult> {
  const result: ReconnectResult = { attempted: 0, connected: 0, failed: 0, skipped: 0 };

  const candidates = contacts.filter((c) => {
    if (!c.ticketString) return false;          // nothing to dial with
    if (blockedDids.has(c.peerDid)) return false;
    if (myDid && c.peerDid === myDid) return false;
    const last = lastAttempt.get(c.peerDid);
    if (!force && last !== undefined && now - last < COOLDOWN_MS) {
      result.skipped += 1;
      return false;
    }
    return true;
  });

  if (candidates.length === 0) return result;

  // Once per sweep, not once per contact: this reads live addresses from the
  // host and updates the transport's cache, which every dial below then uses.
  try {
    await client.refreshTicketAddresses();
  } catch {
    // A refresh failure is not fatal — the cached addresses may still work,
    // and failing the whole sweep here would be worse than trying them.
  }

  await Promise.allSettled(
    candidates.map(async (contact) => {
      lastAttempt.set(contact.peerDid, now);
      result.attempted += 1;

      const { ticket, error } = parseAndValidateTicket(contact.ticketString!, myDid);
      if (!ticket || error) {
        // A stored ticket that no longer parses is a data problem, not a
        // network one, and retrying it every resume will never help.
        result.failed += 1;
        return;
      }

      try {
        // Idempotent, and required before connect: the SDK needs the peer's
        // encryption key recorded before it will encrypt anything for them.
        if (ticket.encryptionKey) {
          client.client.addPeer(ticket.didKey, ticket.encryptionKey);
          // Re-open the conversation alongside re-adding the peer. Idempotent,
          // and it is the cheapest guard against a channel that somehow lacks
          // its guest list -- a state that would present as messages silently
          // reaching nobody rather than as an error.
          if (myDid) openConversation(client, myDid, ticket.didKey);
        }
        await client.client.connect(ticket);
        result.connected += 1;
      } catch {
        // Offline is the ordinary case. Not an error worth surfacing.
        result.failed += 1;
      }
    }),
  );

  return result;
}

/** Testing seam — clears the cooldown table. */
export function resetReconnectCooldowns(): void {
  lastAttempt.clear();
}
