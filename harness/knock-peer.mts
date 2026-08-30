/**
 * A stranger who knocks, for testing the request flow between two Node peers.
 *
 *   npx tsx harness/knock-peer.mts <their-ticket> [displayName]
 *
 * The request flow only fires for a peer you have never paired with, so it
 * cannot be exercised between two devices that are already contacts. This
 * dials a peer it has never met and sends one pairing request — which is all
 * a stranger is allowed to do.
 *
 * It then waits. Accepting on the far side registers this peer, so a message
 * sent from there should arrive here; that is the proof the accept actually
 * paired rather than merely dismissing a card.
 *
 * ## It cannot knock a phone or the desktop app. Measured, not assumed.
 *
 * This runs the SDK's **native** iroh transport. The Tauri app — Android and
 * Windows both — runs the **bridged** one: Rust holds the QUIC connection and
 * the protocol rides a pipe into the webview. The two share an ALPN and do not
 * share a wire format.
 *
 *  - Native opens one QUIC bi-stream per sub-stream, each led by a tag byte,
 *    and expects the handshake challenge back on the control stream.
 *  - Bridged accepts exactly one bi-stream per connection (`accept_bi`, once,
 *    in `src-tauri/src/iroh_bridge.rs`) and multiplexes everything over it.
 *
 * So dialling the app from here completes the QUIC handshake, then dies at the
 * protocol handshake with `FinishedEarly(0)` — the far side closed the control
 * stream having written nothing. It looks exactly like a network fault and is
 * not one: it fails identically with both peers on the same LAN.
 *
 * To knock a phone, knock it from the desktop app, which is bridged too.
 */

import { DicsussionClient } from '@dicsussion/sdk';
import { decodeTicket, encodeTicket } from '@dicsussion/core/transport';

const TICKET = process.argv[2];
const NAME = process.argv[3] ?? 'Knock Test';

if (!TICKET) {
  console.error('Usage: npx tsx harness/knock-peer.mts <their-ticket> [displayName]');
  process.exit(2);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const client = await DicsussionClient.init({ storagePath: ':memory:' }, { transport: 'iroh' });
console.log(`\nmy did : ${client.did}`);
console.log(`name   : ${NAME}\n`);

const theirs = decodeTicket(TICKET);
if (!theirs.encryptionKey) throw new Error('that ticket carries no encryption key');

// Registering them is our side of pairing; it says nothing about theirs, and
// is what lets us dial. They still see a stranger until they accept.
client.addPeer(theirs.didKey, theirs.encryptionKey);

console.log(`dialling ${theirs.didKey.slice(0, 34)}...`);
await client.connect(theirs);
console.log('connected\n');

/*
 * Wait for a relay before knocking.
 *
 * The request carries OUR ticket, and a ticket is a snapshot of how reachable
 * we are right now. Sent immediately it holds LAN addresses only — fine on one
 * network, undialable from anywhere else — and the failure shows up later as a
 * peer who cannot be reached rather than as a bad request.
 */
for (let i = 0; i < 20; i++) {
  const mine = client.getTicket() as { derpRelay?: unknown };
  if (mine.derpRelay) {
    console.log('relay assigned; our ticket is dialable from anywhere');
    break;
  }
  if (i === 19) console.log('no relay yet — knocking anyway, reachable on this network only');
  await wait(400);
}

const delivered = await client.requestPairing(theirs.didKey, { displayName: NAME });
console.log(`\nrequestPairing delivered: ${delivered}`);
console.log(delivered
  ? 'They should now see a request card. Accept it on the device.'
  : 'Not delivered — they were not connected.');

console.log(`\nmy ticket (if you need to add me by hand):\n${encodeTicket(client.getTicket())}\n`);

// Anything arriving here proves the accept paired us rather than just clearing
// the card: an unpaired peer can send nothing.
const CHANNEL = `dm:${[client.did, theirs.didKey].sort().join('|')}`;
client.chat.createChannel(CHANNEL, [theirs.didKey]);
client.chat.onMessage(CHANNEL, (m: { content: string }) => {
  console.log(`  <- message from them: ${m.content}`);
});

console.log('Waiting. Ctrl-C to stop.\n');
setInterval(() => {}, 1 << 30);
