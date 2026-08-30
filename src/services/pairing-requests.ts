/**
 * Knocking, and being knocked on.
 *
 * Both halves of pairing that SDK 0.7.4 made possible, kept away from React so
 * the awkward part — when a ticket is worth sending — can be reasoned about and
 * tested on its own.
 *
 * ## The trap this exists to avoid
 *
 * `requestPairing` sends **our** ticket, and a ticket is a snapshot of how
 * reachable we are at that instant. Address discovery is not immediate: the
 * socket binds first, a public address arrives from STUN some time later, and a
 * relay later still. The natural moment to call this — right after connecting —
 * is exactly when the least is known.
 *
 * A request sent then carries LAN addresses only. It works on the same network
 * and is undialable from anywhere else, and the failure surfaces much later as
 * "that person can't be reached", which looks like a network fault rather than
 * anything to do with pairing. The SDK's own note says to wait for
 * `getTicket().derpRelay` where reaching across networks matters.
 *
 * So this waits for a relay before knocking, and says plainly when it gave up
 * waiting rather than sending something that will not work.
 *
 * ## `delivered` is weaker than it sounds
 *
 * It means the frame left this device on an open connection. It does not mean
 * anyone saw it. A receiver records a peer the first time that peer knocks and
 * drops every later request from them for as long as its app keeps running —
 * so a second knock is reported as sent and is silently discarded, including
 * when the first was auto-declined because they had requests switched off.
 * Measured in `harness/knock-name.mts`.
 *
 * Nothing here can detect that; a stranger is told nothing, which is the
 * design. So the wording below stops short of promising they will see it.
 */

import type { EchoItClient } from "../transport/create-client";

/** How long to wait for a relay before sending anyway. */
const RELAY_WAIT_MS = 8_000;

/** How often to re-check while waiting. */
const POLL_MS = 400;

export interface KnockResult {
  /** Whether the request reached them. `false` means they were not connected. */
  delivered: boolean;
  /** Whether our ticket had a relay on it, so they can dial us from anywhere. */
  reachableAnywhere: boolean;
}

/**
 * Wait until our own ticket is worth handing out.
 *
 * @returns Whether a relay was assigned before the deadline.
 */
async function waitForRelay(client: EchoItClient): Promise<boolean> {
  const deadline = Date.now() + RELAY_WAIT_MS;

  while (Date.now() < deadline) {
    try {
      // Pull fresh addresses from the host before reading the ticket, or the
      // transport's cache answers with whatever it knew at startup.
      await client.refreshTicketAddresses();
      const ticket = client.client.getTicket() as { derpRelay?: unknown };
      if (ticket.derpRelay) return true;
    } catch {
      // Keep waiting; a transient read is not a reason to send a bad ticket.
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return false;
}

/**
 * Ask a peer to pair, carrying our ticket and what we call ourselves.
 *
 * The name is a claim. The SDK is explicit that it carries no authority, so
 * nothing here treats it as more than a string we chose.
 */
export async function knock(
  client: EchoItClient,
  peerDid: string,
  displayName: string,
): Promise<KnockResult> {
  const reachableAnywhere = await waitForRelay(client);

  const delivered = await client.client.requestPairing(peerDid, {
    // An empty name is better sent as absent than as "".
    ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
  });

  return { delivered, reachableAnywhere };
}

/**
 * What to tell someone after knocking.
 *
 * Three outcomes that feel the same and are not: it arrived, they were not
 * there to receive it, or it arrived carrying addresses that only work on this
 * network. The third is the one that would otherwise be discovered days later.
 */
export function describeKnock(result: KnockResult): string {
  if (!result.delivered) {
    return "They are not online right now. They will see your request when you are both connected.";
  }
  if (!result.reachableAnywhere) {
    return "Request sent, but your device has not been given a relay yet — they may only be able to reach you on this network.";
  }
  // Deliberately not "they will see it": a repeat knock is dropped by the
  // receiver without either side being told. Promising delivery here would
  // make the app the source of a false statement.
  return "Request sent. If they are accepting requests, it is waiting for them.";
}
