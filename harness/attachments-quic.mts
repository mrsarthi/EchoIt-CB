/**
 * A file must actually cross the wire.
 *
 *   npm run test:attachments
 *
 * ## Why real QUIC
 *
 * 0.7.0 dropped `attachments` on the wire while every test passed:
 * `encodePayload` names its fields explicitly and the new one was not added, so
 * the handle never travelled in the envelope. The assertion that "a handle
 * arrives with the message" was in fact watching it turn up later by document
 * sync. It surfaced only because a second test read history *after* a sync,
 * where the peer's attachment-less write of the same message id overwrote the
 * sender's copy.
 *
 * Same shape as the `0x07` sub-stream bug one release earlier: a field added to
 * a structure and not to the encoder that serialises it. So this asserts the
 * handle is on the message as delivered, and that the bytes come back byte for
 * byte, over `IrohTransport` rather than the in-process one.
 *
 * ## What is asserted
 *
 * 1. A file goes in and a handle comes back, hashed by content.
 * 2. The handle arrives on the delivered message.
 * 3. The receiver can fetch bytes that match what was sent, exactly.
 * 4. Identical content stores once — the hash is the identity.
 * 5. An oversized file is refused before anything is transferred.
 * 6. Fetching something nobody has fails as itself, not as a hang.
 */

import { createHash } from 'node:crypto';

import { DicsussionClient } from '@dicsussion/sdk';
import { decodeTicket, encodeTicket } from '@dicsussion/core/transport';

import {
  describeBlobError,
  formatSize,
  MAX_ATTACHMENT_BYTES,
  PROTOCOL_MAX_BYTES,
} from '../src/services/attachment-format.js';

const CHANNEL = 'attachments-quic';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

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

// A file with structure rather than zeroes, so a truncated or misassembled
// transfer cannot accidentally compare equal.
const original = new Uint8Array(96 * 1024);
for (let i = 0; i < original.length; i++) original[i] = (i * 31 + (i >> 8)) & 0xff;
const originalHash = sha256(original);

// ── 1. Put ─────────────────────────────────────────────────────────────────
console.log('\n▸ Attaching');
const ref = await alice.blobs.put(original, 'image/png');
check('put returns a handle', Boolean(ref?.hash), `${ref.hash.slice(0, 16)}... ${formatSize(ref.size)}`);
check('the handle is the content hash', ref.hash === originalHash, `${ref.hash.slice(0, 16)}... vs ${originalHash.slice(0, 16)}...`);
check('the handle carries size and type', ref.size === original.length && ref.mime === 'image/png', `${ref.size} bytes, ${ref.mime}`);

// ── 2. The handle must be on the delivered message ─────────────────────────
let delivered: { content: string; attachments?: readonly { hash: string; size: number; mime: string }[] } | undefined;
bob.chat.onMessage(CHANNEL, (m: typeof delivered) => { if (m && !delivered) delivered = m; });

await alice.chat.sendMessage({ channelId: CHANNEL, content: 'look at this', attachments: [ref] });
await wait(4000);

console.log('\n▸ Delivery');
check('bob received the message', delivered !== undefined);
check(
  'the handle travelled with it',
  (delivered?.attachments?.length ?? 0) === 1,
  delivered?.attachments?.length ? 'present' : 'MISSING — this is the 0.7.0 bug',
);
if (delivered?.attachments?.[0]) {
  const got = delivered.attachments[0];
  check('the delivered handle matches', got.hash === ref.hash && got.size === ref.size && got.mime === ref.mime);
}

// ── 3. The bytes ───────────────────────────────────────────────────────────
console.log('\n▸ Fetching the bytes');
let fetched: Uint8Array | undefined;
let fetchError: unknown;
try {
  fetched = await bob.blobs.get(ref);
} catch (error) {
  fetchError = error;
}

check('bob can fetch the blob', fetched !== undefined, fetchError ? describeBlobError(fetchError) : '');
if (fetched) {
  check('the right number of bytes', fetched.length === original.length, `${fetched.length} of ${original.length}`);
  check('byte for byte identical', sha256(fetched) === originalHash, `${sha256(fetched).slice(0, 16)}...`);
}

// ── 4. Content addressing ──────────────────────────────────────────────────
console.log('\n▸ Content addressing');
const again = await alice.blobs.put(original, 'image/png');
check('the same file yields the same handle', again.hash === ref.hash, 'stored once, however many times it arrives');

const different = new Uint8Array(original);
different[0] ^= 0xff;
const differentRef = await alice.blobs.put(different, 'image/png');
check('one changed byte yields a different handle', differentRef.hash !== ref.hash);

// ── 5. The cap ─────────────────────────────────────────────────────────────
console.log('\n▸ Refusals');
// Two different caps, and confusing them made this test wrong once. The SDK
// refuses above PROTOCOL_MAX_BYTES; the app refuses above its own, lower
// MAX_ATTACHMENT_BYTES, set from what actually transfers rather than what is
// permitted. Asking the SDK to refuse the app's limit raised nothing, because
// the app's limit is far below the SDK's.
check(
  "the app's cap is stricter than the protocol's",
  MAX_ATTACHMENT_BYTES < PROTOCOL_MAX_BYTES,
  `app ${formatSize(MAX_ATTACHMENT_BYTES)}, protocol ${formatSize(PROTOCOL_MAX_BYTES)}`,
);

let tooLargeMessage = '';
try {
  // Allocated, not transferred: the refusal must happen before any of this moves.
  await alice.blobs.put(new Uint8Array(PROTOCOL_MAX_BYTES + 1), 'application/octet-stream');
  tooLargeMessage = '(no error raised)';
} catch (error) {
  tooLargeMessage = describeBlobError(error);
}
check(
  'the protocol refuses an oversized file, with a usable sentence',
  tooLargeMessage.includes('too big'),
  tooLargeMessage,
);

// ── 6. Unavailable ─────────────────────────────────────────────────────────
// A handle nobody has. Must fail as itself rather than hanging forever.
const phantom = { hash: 'f'.repeat(64), size: 1024, mime: 'image/png' };
let unavailableMessage = '';
const started = Date.now();
try {
  await bob.blobs.get(phantom);
  unavailableMessage = '(no error raised)';
} catch (error) {
  unavailableMessage = describeBlobError(error);
}
const waited = Date.now() - started;
check(
  'a blob nobody has fails, and says so',
  unavailableMessage.includes('Not available') || unavailableMessage.includes('not available'),
  `${unavailableMessage} after ${Math.round(waited / 1000)}s`,
);

console.log(`\n${'─'.repeat(64)}`);
if (failures.length) {
  console.log(`FAIL  ${failures.length} check(s) failed:`);
  for (const f of failures) console.log(`        - ${f}`);
} else {
  console.log('PASS  files cross the wire intact, and refusals are legible');
}
console.log('─'.repeat(64));

await alice.disconnect().catch(() => {});
await bob.disconnect().catch(() => {});
process.exit(failures.length ? 1 : 0);
