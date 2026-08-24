/**
 * One-to-one conversations — M2.4.
 *
 * A conversation is an SDK channel whose guest list holds exactly the two
 * participants. Since SDK 0.4.0 that guest list is an authorization boundary:
 * `publish` skips peers who fail `mayReceive`, and document sync filters on
 * both send and receive. `harness/three-peer-privacy.mts` is what proves it —
 * a third contact receives nothing.
 *
 * **The failure mode to keep in mind.** The filter is fail-closed. A channel
 * whose guest list is missing the peer does not error; it sends to nobody and
 * reports success. That looks exactly like the bug the filter was added to fix,
 * so `createChannel` has to be called everywhere a peer becomes known —
 * pairing, accepting a request, and every reconnect sweep.
 */

import type { EchoItClient } from "../transport/create-client";

/** A message as the UI wants it, decoupled from the SDK's shape. */
export interface ConversationMessage {
  id: string;
  authorDid?: string;
  content: string;
  timestamp: number;
}

/**
 * The channel two people share.
 *
 * Sorted so both sides derive the same id from the same pair with nothing
 * exchanged — there is no round trip in which the two could disagree.
 *
 * **Not hashed, deliberately.** Hashing was considered, to stop the id itself
 * naming its participants. It was dropped because it buys nothing against the
 * threat: deriving `sha256(a|b)` needs exactly the same two did:keys as
 * deriving `a|b`, so guessability is unchanged, and message bodies are stored
 * unencrypted anyway (Finding 11) — so anyone who can read the id can already
 * read the conversation. What would actually help is an inbound entitlement
 * check in the SDK, so a sender cannot declare their own membership. Logged
 * rather than worked around here.
 */
export function channelIdFor(a: string, b: string): string {
  return `dm:${[a, b].sort().join("|")}`;
}

/**
 * Open a conversation and record who is entitled to it.
 *
 * Idempotent by the SDK's contract — an existing channel gains any participants
 * it lacks and keeps the rest — so calling it on every reconnect is free and is
 * the cheapest defence against a channel that somehow lost its guest list.
 */
export function openConversation(client: EchoItClient, myDid: string, peerDid: string): string {
  const channelId = channelIdFor(myDid, peerDid);
  client.client.chat.createChannel(channelId, [peerDid]);
  return channelId;
}

/**
 * Write the CRDT documents to storage.
 *
 * **Messages are not durable until this runs.** `sendMessage` and
 * `ingestRemote` both write into an in-memory Automerge document;
 * `client.checkpoint()` is what puts it in IndexedDB, and the SDK only calls it
 * itself from `disconnect()`. Nothing in a desktop or mobile app calls
 * `disconnect()` when the user simply closes it, so without this every
 * conversation vanished on the next launch — reported from real use as "when I
 * open the app again, the previous msgs disappear".
 *
 * Cheap enough to call on every message at beta scale, and calling it too often
 * is a far better failure than calling it too rarely.
 */
export function checkpoint(client: EchoItClient): void {
  try {
    client.client.checkpoint();
  } catch {
    // Never let a storage hiccup fail the send that triggered it. The message
    // is already in the document; the worst case is that it is checkpointed by
    // the next one instead.
  }
}

/** Send to a peer. Resolves with the message as the UI should show it. */
export async function sendToPeer(
  client: EchoItClient,
  myDid: string,
  peerDid: string,
  content: string,
): Promise<ConversationMessage> {
  const channelId = openConversation(client, myDid, peerDid);
  const sent = await client.client.chat.sendMessage({ channelId, content });
  checkpoint(client);
  return {
    id: sent.id,
    authorDid: sent.authorDid,
    content: sent.content,
    timestamp: sent.timestamp,
  };
}

/** Everything already stored for a conversation, oldest first. */
export async function historyWithPeer(
  client: EchoItClient,
  myDid: string,
  peerDid: string,
): Promise<ConversationMessage[]> {
  const channelId = channelIdFor(myDid, peerDid);
  const history = await client.client.chat.getHistory(channelId);
  return history.map((m) => ({
    id: m.id,
    authorDid: m.authorDid,
    content: m.content,
    timestamp: m.timestamp,
  }));
}

/**
 * Listen for messages arriving from a peer.
 *
 * Covers both delivery paths without the caller needing to know there are two:
 * a live envelope on `0x02` runs through `ingestRemote`, and a message that
 * arrives by document sync on `0x01` is emitted by the client's own
 * `emitSynced` — which exists precisely because the sync path used to notify
 * nobody, and an app listening on this callback could not tell that from loss.
 *
 * @returns Unsubscribe.
 */
export function subscribeToPeer(
  client: EchoItClient,
  myDid: string,
  peerDid: string,
  onMessage: (message: ConversationMessage) => void,
): () => void {
  const channelId = channelIdFor(myDid, peerDid);
  return client.client.chat.onMessage(channelId, (m) => {
    onMessage({
      id: m.id,
      authorDid: m.authorDid,
      content: m.content,
      timestamp: m.timestamp,
    });
  });
}
