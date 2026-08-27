/**
 * A real peer that heartbeats, for watching presence on a device.
 *
 *   npx tsx harness/presence-peer.mts                  # wait to be dialled
 *   npx tsx harness/presence-peer.mts <peer-ticket>    # dial that peer
 *
 * Presence cannot be checked on one phone alone: the dot reports somebody
 * *else*. This stands in for that somebody when a second device is not to hand.
 * It speaks the same heartbeat the app does (`echoit:hb:1` over stream `0x07`)
 * on the same `dm:` channel id, so the app cannot tell it from a phone.
 *
 * Being dialled is the practical direction when driving a phone over CDP: the
 * app offers its ticket only through a copy-to-clipboard button, and a webview
 * refuses to hand the clipboard back ("Document is not focused"). An inbound
 * connection carries the peer's did, which is all that is needed here.
 *
 * The interesting half is stopping it. Kill this process and the app should go
 * grey — first because `onPeerDisconnected` reaches the other side, and failing
 * that because the heartbeats stop and the window lapses. A dot that lights up
 * is easy; one that goes out is the whole problem, and it is invisible unless
 * something actually leaves.
 */

import { DicsussionClient } from '@dicsussion/sdk';
import { decodeTicket, encodeTicket } from '@dicsussion/core/transport';

import { HEARTBEAT_INTERVAL_MS } from '../src/services/presence.js';

const HEARTBEAT = new TextEncoder().encode('echoit:hb:1');

/** Must match `channelIdFor` in src/services/conversation.ts. */
const channelIdFor = (a: string, b: string) => `dm:${[a, b].sort().join('|')}`;

const client = await DicsussionClient.init({ storagePath: ':memory:' }, { transport: 'iroh' });

console.log(`\nmy did    : ${client.did}`);
console.log(`my ticket : ${encodeTicket(client.getTicket())}\n`);

let channelId: string | undefined;

/**
 * Begin heartbeating to whoever we are now paired with.
 *
 * Split out because the peer can arrive two ways and both are needed: dialled
 * by us from a ticket, or dialling us.
 */
const startBeating = (peerDid: string) => {
  if (channelId) return;
  channelId = channelIdFor(client.did, peerDid);
  client.chat.createChannel(channelId, [peerDid]);

  client.chat.onEphemeral(channelId, (fromDid: string, payload: Uint8Array) => {
    if (fromDid === client.did) return;
    const known = payload.length === HEARTBEAT.length && HEARTBEAT.every((b, i) => payload[i] === b);
    console.log(`  <- ${known ? 'heartbeat' : `${payload.length} bytes`} from ${fromDid.slice(0, 24)}...`);
  });

  client.chat.onMessage(channelId, (m: { content: string }) => {
    console.log(`  <- message: ${m.content}`);
  });

  console.log(`\npaired with ${peerDid.slice(0, 34)}...`);
  console.log(`channel     ${channelId}\n`);

  const beat = async () => {
    try {
      // Zero is normal: nobody was connected, not a failure.
      const reached = await client.chat.sendEphemeral(channelId!, HEARTBEAT);
      console.log(`  -> heartbeat, reached ${reached} peer(s)`);
    } catch (error) {
      console.log(`  -> heartbeat failed: ${(error as Error).message}`);
    }
  };
  void beat();
  setInterval(beat, HEARTBEAT_INTERVAL_MS);
};

// Someone dialling us is enough to learn who they are.
const connected = (client as unknown as {
  onPeerConnected?: { on: (event: string, fn: (x: { peerDid: string }) => void) => unknown };
}).onPeerConnected;

connected?.on('peer', ({ peerDid }) => {
  console.log(`\n<- inbound connection from ${peerDid.slice(0, 34)}...`);
  startBeating(peerDid);
});

const peerTicketArg = process.argv[2];
if (peerTicketArg) {
  const ticket = decodeTicket(peerTicketArg);
  if (!ticket.encryptionKey) throw new Error('that ticket carries no encryption key');
  client.addPeer(ticket.didKey, ticket.encryptionKey);
  await client.connect(ticket);
  console.log(`connected to ${ticket.didKey.slice(0, 34)}...`);
  startBeating(ticket.didKey);
} else {
  console.log('Waiting to be dialled. Paste the ticket above into the app:');
  console.log('  Contacts -> Add Contact -> paste -> Connect\n');
}

console.log(`Heartbeating every ${HEARTBEAT_INTERVAL_MS / 1000}s once paired.`);
console.log('Ctrl-C to leave, which is the case worth watching.\n');

// Leave properly on the way out, so the app is told rather than left to time
// out. Both paths matter and only one of them is quick.
const leave = async () => {
  console.log('\ndisconnecting...');
  try {
    await client.disconnect();
  } catch {
    // Going away regardless; the window lapses on the other side.
  }
  process.exit(0);
};
process.on('SIGINT', () => void leave());
process.on('SIGTERM', () => void leave());

setInterval(() => {}, 1 << 30);
