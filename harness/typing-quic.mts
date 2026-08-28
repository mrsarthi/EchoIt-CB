/**
 * "typing…" crosses the wire, expires, and is never written down.
 *
 *   npm run test:typing
 *
 * ## Why real QUIC
 *
 * The typing signal shares stream `0x07` with the presence heartbeat, and that
 * stream has already produced one failure invisible to the in-process
 * transport: `sendEphemeral` threw "sub-stream 0x7 is not open" over QUIC while
 * passing 8/8 against `LocalTransport`, because that transport opens
 * sub-streams on demand and Iroh's list had not grown.
 *
 * Two signals now share the stream, so the check that matters most is that they
 * stay distinguishable: a heartbeat misread as typing would show every contact
 * with the app open as composing a message.
 *
 * ## What is asserted
 *
 * 1. A typing signal reaches the peer and is recognised.
 * 2. A heartbeat is NOT mistaken for typing.
 * 3. Nothing lands in message history.
 * 4. The indicator expires on its own, with no "stopped" message.
 */

import { DicsussionClient } from '@dicsussion/sdk';
import { decodeTicket, encodeTicket } from '@dicsussion/core/transport';

import { isTyping, TYPING_TTL_MS, TYPING_REPEAT_MS, shouldSendTyping } from '../src/services/typing.js';

const CHANNEL = 'typing-quic';
const TYPING = new TextEncoder().encode('echoit:typing:1');
const HEARTBEAT = new TextEncoder().encode('echoit:hb:1');

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} - ${name}${!ok && detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

console.log('▸ Timing, before touching the network');

check(
  'the lifetime outlasts the repeat interval',
  TYPING_TTL_MS > TYPING_REPEAT_MS * 2,
  `${TYPING_TTL_MS}ms lifetime, ${TYPING_REPEAT_MS}ms repeat — one dropped signal must not blink it off`,
);
check('a fresh signal shows as typing', isTyping(Date.now(), Date.now()));
check(
  'a stale signal does not',
  !isTyping(Date.now() - (TYPING_TTL_MS + 500), Date.now()),
  'there is no "stopped" message, so it has to expire by itself',
);
check('never having heard is not typing', !isTyping(undefined, Date.now()));
check('the first keystroke sends', shouldSendTyping(undefined, Date.now()));
check(
  'the next keystroke does not',
  !shouldSendTyping(Date.now(), Date.now() + 50),
  'otherwise a fast typist emits a packet per character',
);

console.log('\n▸ Two peers over real QUIC');

const alice = await DicsussionClient.init({ storagePath: ':memory:' }, { transport: 'iroh' });
const bob = await DicsussionClient.init({ storagePath: ':memory:' }, { transport: 'iroh' });

const at = decodeTicket(encodeTicket(alice.getTicket()));
const bt = decodeTicket(encodeTicket(bob.getTicket()));
alice.addPeer(bt.didKey, bt.encryptionKey!);
bob.addPeer(at.didKey, at.encryptionKey!);
alice.chat.createChannel(CHANNEL, [bt.didKey]);
bob.chat.createChannel(CHANNEL, [at.didKey]);
await alice.connect(bt);
await wait(2000);

const seen: string[] = [];
let typingAt: number | undefined;

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && b.every((x, i) => a[i] === x);

bob.chat.onEphemeral(CHANNEL, (from: string, payload: Uint8Array) => {
  if (from === bob.did) return;
  if (same(payload, TYPING)) { seen.push('typing'); typingAt = Date.now(); return; }
  if (same(payload, HEARTBEAT)) { seen.push('heartbeat'); return; }
  seen.push(`unknown:${payload.length}`);
});

const reached = await alice.chat.sendEphemeral(CHANNEL, TYPING);
await wait(2500);

console.log(`  sendEphemeral reached ${reached} peer(s)`);
check('the typing signal arrives', seen.includes('typing'), `saw: ${seen.join(',') || 'nothing'}`);
check('bob sees alice as typing', isTyping(typingAt, Date.now()));

// The distinction that matters now that two signals share the stream.
seen.length = 0;
await alice.chat.sendEphemeral(CHANNEL, HEARTBEAT);
await wait(2000);
check(
  'a heartbeat is not mistaken for typing',
  seen.includes('heartbeat') && !seen.includes('typing'),
  `saw: ${seen.join(',') || 'nothing'} — mistaking these would show every contact with the app open as composing`,
);

const history = await bob.chat.getHistory(CHANNEL);
check(
  'nothing was written to history',
  history.length === 0,
  `${history.length} message(s) stored — a signal every 2s would grow this forever`,
);

console.log('\n▸ Expiry');
check(
  'the indicator lapses without a stop message',
  !isTyping(typingAt, Date.now() + TYPING_TTL_MS + 1000),
  'a lost stop message would otherwise latch it on permanently',
);

console.log(`\n${'─'.repeat(64)}`);
if (failures.length) {
  console.log(`FAIL  ${failures.length} check(s) failed:`);
  for (const f of failures) console.log(`        - ${f}`);
} else {
  console.log('PASS  typing crosses the wire, stays off disk, and expires');
}
console.log('─'.repeat(64));

await alice.disconnect().catch(() => {});
await bob.disconnect().catch(() => {});
process.exit(failures.length ? 1 : 0);
