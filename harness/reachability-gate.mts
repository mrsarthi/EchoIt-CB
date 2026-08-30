/**
 * A message is only handed to the network when someone is actually there.
 *
 *   npx tsx harness/reachability-gate.mts
 *
 * Measured on two phones, SDK 0.8.0, the real app: of four messages sent to a
 * frozen peer, three were reported sent and ceased to exist, and the fourth --
 * sent late enough that QUIC had finally noticed -- queued and arrived. The
 * only difference between the three and the one was elapsed time.
 *
 * The gate turns that elapsed time into an explicit decision. What is tested
 * here is the decision and the queue that holds the result, away from any
 * device: whether staleness is judged correctly, and whether the queue can lose
 * a message.
 */

import {
  isReachable,
  describeWaiting,
  REACHABLE_WINDOW_MS,
} from '../src/services/reachability.js';
import {
  enqueue,
  remove,
  pendingFor,
  pendingId,
  isPendingId,
  loadPending,
  type PendingSend,
} from '../src/services/pending-sends.js';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const NOW = 1_788_000_000_000;

// The decision.
check('a peer heard from just now is reachable', isReachable(NOW - 1_000, NOW));
check('a peer heard from within the window is reachable',
  isReachable(NOW - (REACHABLE_WINDOW_MS - 1_000), NOW));
check('a peer heard from past the window is not',
  !isReachable(NOW - (REACHABLE_WINDOW_MS + 1_000), NOW));
check('exactly at the window is not reachable — the boundary excludes',
  !isReachable(NOW - REACHABLE_WINDOW_MS, NOW));
check('a peer never heard from is not reachable', !isReachable(undefined, NOW));
check('a timestamp in the future is not evidence of presence',
  !isReachable(NOW + 60_000, NOW),
  'a clock that moved would otherwise make a peer permanently sendable');

// The window is presence's, so the dot and the send agree.
check('the window matches the one that lights the green dot',
  REACHABLE_WINDOW_MS === 75 * 1000, `${REACHABLE_WINDOW_MS}ms`);

// What the person is told.
check('never heard from is said plainly',
  /nothing has arrived from them yet/.test(describeWaiting(undefined, NOW)));
check('minutes are counted', /2 minutes ago/.test(describeWaiting(NOW - 2 * 60_000, NOW)));
check('one minute is singular', /1 minute ago/.test(describeWaiting(NOW - 60_000, NOW)));
check('hours are counted', /3 hours ago/.test(describeWaiting(NOW - 3 * 3_600_000, NOW)));
check('days are counted', /2 days ago/.test(describeWaiting(NOW - 2 * 86_400_000, NOW)));
check('under a minute does not say "0 minutes"',
  !/0 minute/.test(describeWaiting(NOW - 5_000, NOW)), describeWaiting(NOW - 5_000, NOW));

// The queue.
const entry = (id: string, peerDid: string, at: number): PendingSend =>
  ({ id, peerDid, text: `msg ${id}`, queuedAt: at });

let queue: PendingSend[] = [];
queue = enqueue(queue, entry('a', 'did:key:one', 3));
queue = enqueue(queue, entry('b', 'did:key:two', 1));
queue = enqueue(queue, entry('c', 'did:key:one', 2));

check('everything queued is kept', queue.length === 3);
check('a peer sees only their own, oldest first',
  pendingFor(queue, 'did:key:one').map((p) => p.id).join(',') === 'c,a');
check('a peer with nothing queued sees nothing',
  pendingFor(queue, 'did:key:three').length === 0);

const afterSend = remove(queue, ['c']);
check('a sent message leaves the queue', afterSend.length === 2);
check('and the others stay', afterSend.map((p) => p.id).sort().join(',') === 'a,b');
check('removing nothing changes nothing', remove(queue, []).length === 3);
check('removing an unknown id is harmless', remove(queue, ['zzz']).length === 3);
check('the original queue is not mutated', queue.length === 3);

/*
 * The failure this must not have: a partial flush.
 *
 * Removing "the first n" after sending n would be correct only if the send
 * order matched the queue order and nothing failed halfway. Removing by id is
 * what makes an interrupted flush lose nothing.
 */
const partial = remove(queue, ['a']);
check('an interrupted flush drops only what was sent',
  partial.map((p) => p.id).sort().join(',') === 'b,c');

// Ids.
const id1 = pendingId();
const id2 = pendingId();
check('a pending id is recognisable as one', isPendingId(id1));
check('two are distinct', id1 !== id2);
check('an SDK-style id is not mistaken for one',
  !isPendingId('9f3a2c1e-0000-4000-8000-000000000000'));

// Storage is best effort and must never throw into a render. `localStorage`
// does not exist in Node, which is the "storage unavailable" case exactly.
check('a missing localStorage yields an empty queue rather than throwing',
  loadPending('did:key:me').length === 0);

console.log(`\n${'-'.repeat(60)}`);
console.log(failures ? `FAIL  ${failures} check(s)` : 'PASS  the gate judges presence and the queue loses nothing');
console.log('-'.repeat(60));
process.exit(failures ? 1 : 0);
