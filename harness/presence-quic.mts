/**
 * Presence must go **off**, over real QUIC.
 *
 *   npm run test:presence-quic
 *
 * ## Why this exists, and why it is not on the in-process transport
 *
 * A green dot driven by connection alone switches on and never off. Turning it
 * off is the whole difficulty, and it is precisely what the SDK's own tests
 * missed: 0.7.0 shipped `onPeerDisconnected` firing only for the side that
 * called `disconnect()`. The remote peer — the one that needs to know — was
 * never told over QUIC. Every SDK test passed, because `LocalTransport.close()`
 * propagates the close explicitly and cannot exhibit the bug.
 *
 * That was the third QUIC-only failure in one release (a sub-stream never
 * opened, then attachments dropped from the envelope, then this). The protocol
 * log draws the conclusion itself: anything touching connection lifecycle or
 * the wire needs testing on `IrohTransport`, not through the in-process one.
 *
 * So this suite dials over the real network. `test:bridge` runs a bridged pipe
 * and would not catch a regression here.
 *
 * ## What is asserted
 *
 * 1. A heartbeat crosses the wire and is recognised.
 * 2. It is **ephemeral** — nothing lands in message history.
 * 3. Silence lapses to offline once the window passes.
 * 4. A real departure is reported to the *remote* side. This is the 0.7.0 bug.
 */

import { DicsussionClient } from '@dicsussion/sdk';
import { decodeTicket, encodeTicket } from '@dicsussion/core/transport';

import { presenceFrom, ONLINE_WINDOW_MS } from '../src/services/presence.js';
import { toMillis } from '../src/services/timestamps.js';

const CHANNEL = 'presence-quic';
const HEARTBEAT = new TextEncoder().encode('echoit:hb:1');

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

console.log('▸ Two peers over real QUIC');

const alice = await DicsussionClient.init({ storagePath: ':memory:' }, { transport: 'iroh' });
const bob = await DicsussionClient.init({ storagePath: ':memory:' }, { transport: 'iroh' });

const aliceTicket = decodeTicket(encodeTicket(alice.getTicket()));
const bobTicket = decodeTicket(encodeTicket(bob.getTicket()));

alice.addPeer(bobTicket.didKey, bobTicket.encryptionKey!);
bob.addPeer(aliceTicket.didKey, aliceTicket.encryptionKey!);
alice.chat.createChannel(CHANNEL, [bobTicket.didKey]);
bob.chat.createChannel(CHANNEL, [aliceTicket.didKey]);

await alice.connect(bobTicket);
await wait(2000);

// ── 1. A heartbeat crosses the wire ────────────────────────────────────────
let heardAt: number | undefined;
bob.chat.onEphemeral(CHANNEL, (fromDid: string, payload: Uint8Array) => {
  if (fromDid === bob.did) return;
  if (payload.length === HEARTBEAT.length && HEARTBEAT.every((b, i) => payload[i] === b)) {
    heardAt = Date.now();
  }
});

const reached = await alice.chat.sendEphemeral(CHANNEL, HEARTBEAT);
await wait(2000);

console.log(`\n▸ Heartbeat (sendEphemeral reached ${reached} peer(s))`);
check('bob receives alice\'s heartbeat', heardAt !== undefined);
check(
  'alice reads as online',
  presenceFrom(heardAt, Date.now()).state === 'online',
  presenceFrom(heardAt, Date.now()).state,
);

// ── 2. It must not be stored ───────────────────────────────────────────────
const history = await bob.chat.getHistory(CHANNEL);
check(
  'the heartbeat is not written to history',
  history.length === 0,
  `${history.length} message(s) stored — a heartbeat every 30s would grow this forever`,
);

// ── 3. Silence lapses ──────────────────────────────────────────────────────
console.log('\n▸ Silence');
const stale = Date.now() - (ONLINE_WINDOW_MS + 1000);
check(
  'a peer we stopped hearing from goes offline',
  presenceFrom(stale, Date.now()).state === 'offline',
  `${Math.round(ONLINE_WINDOW_MS / 1000)}s window`,
);
check(
  'a peer never heard from is unknown, not offline',
  presenceFrom(undefined, Date.now()).state === 'unknown',
  'so a new contact does not read "last seen 56 years ago"',
);

// ── 4. Departure reaches the REMOTE side — the 0.7.0 bug ───────────────────
console.log('\n▸ Departure');

let bobSawAliceLeave: { peerDid: string; at?: number } | undefined;
const departures = (bob as unknown as {
  onPeerDisconnected?: { on: (e: string, fn: (x: { peerDid: string; at?: number }) => void) => unknown };
}).onPeerDisconnected;

check('the SDK exposes onPeerDisconnected', Boolean(departures?.on));

if (departures?.on) {
  departures.on('peer', (event) => { bobSawAliceLeave = event; });
}

await alice.disconnect();
await wait(6000);

check(
  'bob is told that alice left',
  bobSawAliceLeave !== undefined,
  bobSawAliceLeave ? `at ${bobSawAliceLeave.at ?? 'unspecified'}` : 'never fired — this is the 0.7.0 bug',
);

if (bobSawAliceLeave) {
  const raw = bobSawAliceLeave.at;

  // The event reports SECONDS, as message timestamps do. Left raw it is ~1.79e9
  // against a heard-at of ~1.79e12, so it always looks older than the last
  // heartbeat, the departure is discarded, and the dot stays green for someone
  // who has left. Asserted directly so a future SDK switching units is caught
  // here rather than by someone staring at a stuck green dot.
  check(
    'the departure time needs normalising to milliseconds',
    raw !== undefined && raw < 1e12,
    `at=${raw} — seconds, not milliseconds`,
  );

  const departedAt = raw === undefined ? Date.now() : toMillis(raw);
  const departed = presenceFrom(heardAt, Date.now(), departedAt);
  check(
    'a departure turns the dot off immediately',
    departed.state === 'offline',
    `${departed.state} — without this the dot waits ${Math.round(ONLINE_WINDOW_MS / 1000)}s`,
  );
}

console.log(`\n${'─'.repeat(64)}`);
if (failures.length) {
  console.log(`FAIL  ${failures.length} check(s) failed:`);
  for (const f of failures) console.log(`        - ${f}`);
} else {
  console.log('PASS  presence turns on, stays off disk, and turns off');
}
console.log('─'.repeat(64));

await bob.disconnect().catch(() => {});
process.exit(failures.length ? 1 : 0);
