/**
 * A name sent with a pairing request arrives with it.
 *
 *   npx tsx harness/knock-name.mts
 *
 * Measured on real devices: the desktop app knocked two phones with
 * `displayName: "Desktop Stranger"` — confirmed by a probe at the call site —
 * and both phones rendered the "no name given" fallback. The claim is the only
 * thing on a request card that tells a person who is knocking, so losing it
 * turns every request into "Device ending in ...poVTQW", which nobody can act
 * on.
 *
 * This pins the name to the wire between two Node peers, so the next time it
 * goes missing the answer to "is it the SDK or is it the app" is one command
 * rather than an afternoon of device driving.
 */

import { DicsussionClient } from '@dicsussion/sdk';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const NAME = 'Desktop Stranger';

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const stranger = await DicsussionClient.init({ storagePath: ':memory:' }, { transport: 'iroh' });
const host = await DicsussionClient.init({ storagePath: ':memory:' }, { transport: 'iroh' });

const seen: Array<{ peerDid: string; displayName?: string }> = [];
host.onPairingRequest.on('request', (r: { peerDid: string; displayName?: string }) => {
  seen.push({ peerDid: r.peerDid, displayName: r.displayName });
});

// Wait for a relay before publishing the host's ticket, for the same reason
// `knock()` does: a ticket read too early carries LAN addresses only.
for (let i = 0; i < 25 && !(host.getTicket() as { derpRelay?: unknown }).derpRelay; i++) {
  await wait(400);
}

const theirs = host.getTicket();
stranger.addPeer(theirs.didKey, theirs.encryptionKey!);
await stranger.connect(theirs);

for (let i = 0; i < 25 && !(stranger.getTicket() as { derpRelay?: unknown }).derpRelay; i++) {
  await wait(400);
}

const delivered = await stranger.requestPairing(theirs.didKey, { displayName: NAME });
check('the request was delivered', delivered);

for (let i = 0; i < 25 && seen.length === 0; i++) await wait(200);

check('the host saw exactly one request', seen.length === 1, `${seen.length} seen`);
check('from the peer that sent it', seen[0]?.peerDid === stranger.did);
check('carrying the name that was sent',
  seen[0]?.displayName === NAME,
  seen[0] ? `got ${JSON.stringify(seen[0].displayName)}` : 'nothing arrived');

// A knock with no name must arrive as absent, not as an empty string — the
// card branches on falsiness and "" would render the fallback either way, but
// only `undefined` says "they claimed nothing" rather than "they claimed ''".
const second = await DicsussionClient.init({ storagePath: ':memory:' }, { transport: 'iroh' });
second.addPeer(theirs.didKey, theirs.encryptionKey!);
await second.connect(theirs);
for (let i = 0; i < 25 && !(second.getTicket() as { derpRelay?: unknown }).derpRelay; i++) {
  await wait(400);
}
const namelessDelivered = await second.requestPairing(theirs.didKey);
check('a nameless request is delivered too', namelessDelivered);
for (let i = 0; i < 50 && seen.length < 2; i++) await wait(200);
check('a nameless knock arrives with no name',
  seen.length === 2 && seen[1].displayName === undefined,
  seen[1] ? JSON.stringify(seen[1].displayName) : 'nothing arrived');

/*
 * A second knock from the same peer never arrives, even after a decline.
 *
 * `SessionManager` records a peer the first time it sends a pairing request
 * and drops every later one for the lifetime of the process. That is a
 * sensible ration against a stranger flooding the screen, and it has a
 * consequence worth knowing: once a request from someone has been consumed —
 * including one that was auto-declined because the user had requests switched
 * off, or one that arrived before they typed a name — nothing they send can
 * replace it until the receiving app is restarted. The app's own "a repeat
 * knock refreshes the name" path cannot fire, because no repeat is delivered.
 *
 * Pinned as observed behaviour, not endorsed: if it changes upstream, this
 * says so rather than the symptom turning up on a device weeks later.
 */
host.declinePairingRequest({ peerDid: stranger.did } as never);
const before = seen.length;
const repeat = await stranger.requestPairing(theirs.didKey, { displayName: 'Renamed' });
for (let i = 0; i < 25 && seen.length === before; i++) await wait(200);
check('a repeat knock reports as sent', repeat);
check('but the receiver never sees it — one per peer, per run',
  seen.length === before,
  `${seen.length - before} extra request(s)`);

await Promise.all([stranger.disconnect(), host.disconnect(), second.disconnect()]);

console.log(`\n${'─'.repeat(60)}`);
console.log(failures ? `FAIL  ${failures} check(s)` : 'PASS  the claimed name survives the wire');
console.log('─'.repeat(60));
process.exit(failures ? 1 : 0);
