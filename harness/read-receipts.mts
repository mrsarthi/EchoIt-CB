/**
 * Ticks tell the truth, and never walk backwards.
 *
 *   npx tsx harness/read-receipts.mts
 *
 * Message status has been rendered since the chat view was written and has
 * never once been fed: nothing anywhere set `status`, so every message a
 * person ever sent read "Staged" — including ones watched arriving on another
 * device. This is the logic that now feeds it, tested away from the component
 * that draws it.
 *
 * The failures worth catching are the ones that look fine in a screenshot:
 * a status that goes read -> delivered when a stale receipt arrives late, a
 * heartbeat parsed as a receipt (which would mark a conversation read the
 * moment someone opened the app), and a read watermark that outruns the
 * delivered one producing a state that means nothing.
 */

import {
  statusBoundaries,
  encodeReceipt,
  decodeReceipt,
  applyReceipt,
  statusFor,
  describeStatus,
  type Watermarks,
} from '../src/services/receipts.js';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// Round trip.
for (const kind of ['delivered', 'read'] as const) {
  const back = decodeReceipt(encodeReceipt({ kind, upTo: 1788019957112 }));
  check(`a ${kind} receipt survives the wire`,
    back?.kind === kind && back?.upTo === 1788019957112,
    JSON.stringify(back));
}

// Nothing else on stream 0x07 may be mistaken for one.
const enc = (s: string) => new TextEncoder().encode(s);
check('a heartbeat is not a receipt', decodeReceipt(enc('echoit:hb:1')) === undefined);
check('a typing signal is not a receipt', decodeReceipt(enc('echoit:typing:1')) === undefined);
check('an empty payload is not a receipt', decodeReceipt(new Uint8Array()) === undefined);
check('a truncated watermark is rejected, not truncated',
  decodeReceipt(enc('echoit:rcpt:1:d:17880abc')) === undefined);
check('an unknown kind is rejected', decodeReceipt(enc('echoit:rcpt:1:x:100')) === undefined);
check('a missing number is rejected', decodeReceipt(enc('echoit:rcpt:1:d:')) === undefined);
check('invalid utf-8 is rejected, not thrown on',
  decodeReceipt(new Uint8Array([0xff, 0xfe, 0xfd])) === undefined);

// The three states.
const marks: Watermarks = { deliveredUpTo: 200, readUpTo: 100 };
check('a message past both watermarks is only sent', statusFor(300, marks) === 'sent');
check('a message inside delivered is delivered', statusFor(150, marks) === 'delivered');
check('a message inside read is read', statusFor(50, marks) === 'read');
check('a message exactly at the watermark counts', statusFor(100, marks) === 'read');
check('with no receipts at all, everything is sent', statusFor(1, undefined) === 'sent');

// Read implies delivered, even from a peer that reports them inconsistently.
check('a read watermark ahead of delivered still reads as read',
  statusFor(500, { deliveredUpTo: 100, readUpTo: 900 }) === 'read');
check('and does not leave a gap that reads as merely sent',
  statusFor(150, { deliveredUpTo: 100, readUpTo: 900 }) === 'read');

// Watermarks never move backwards.
{
  let w: Watermarks = {};
  w = applyReceipt(w, { kind: 'delivered', upTo: 500 });
  w = applyReceipt(w, { kind: 'read', upTo: 400 });
  check('a later replay of an older delivered receipt does not lower it',
    applyReceipt(w, { kind: 'delivered', upTo: 100 }).deliveredUpTo === 500);
  check('nor an older read receipt',
    applyReceipt(w, { kind: 'read', upTo: 1 }).readUpTo === 400);
  check('a newer one advances it',
    applyReceipt(w, { kind: 'read', upTo: 999 }).readUpTo === 999);
  check('a message does not flip from read back to delivered on a stale replay',
    statusFor(300, applyReceipt(w, { kind: 'delivered', upTo: 10 })) === 'read');
}

/*
 * Where the status marker goes.
 *
 * Reported as "seen status is visible after every msg" -- three messages in a
 * row carried three identical Read markers. A watermark says one thing about
 * all of them, so it should be said once.
 */
{
  const out = (id: string, at: number) => ({ id, at, isOutgoing: true });
  const marks = { deliveredUpTo: 300, readUpTo: 200 };

  const run = [out('a', 100), out('b', 150), out('c', 200)];
  const shown = statusBoundaries(run, marks);
  check('three messages of the same status collapse to one marker',
    shown.size === 1 && shown.has('c'), [...shown].join(','));

  const mixed = [out('a', 100), out('b', 200), out('c', 250), out('d', 400)];
  const marked = statusBoundaries(mixed, marks);
  check('a change of status is always visible',
    marked.size === 3 && marked.has('b') && marked.has('c') && marked.has('d'),
    [...marked].join(','));
  check('and never more than three, however long the thread',
    statusBoundaries([...mixed, out('e', 401), out('f', 402)], marks).size === 3);

  const interrupted = [out('a', 100), { id: 'theirs', at: 120, isOutgoing: false }, out('b', 150)];
  check('a reply in the middle does not restart the run',
    statusBoundaries(interrupted, marks).size === 1);

  const waiting = [out('a', 100), { id: 'w', at: 999, isOutgoing: true, status: 'waiting' }];
  check('a message still waiting is not a boundary of its own',
    !statusBoundaries(waiting, marks).has('w'));

  check('one message still gets its marker', statusBoundaries([out('a', 100)], marks).has('a'));
  check('an empty thread shows nothing', statusBoundaries([], marks).size === 0);
  check('with no receipts at all, only the newest is marked',
    statusBoundaries(run, undefined).size === 1);
}

// The words a person actually sees.
check('read names the person', describeStatus('read', 'Sunny') === 'Read by Sunny');
check('delivered says device, not person',
  /device/.test(describeStatus('delivered', 'Sunny')));
check('sent claims nothing about them', describeStatus('sent', 'Sunny') === 'Sent');

console.log(`\n${'─'.repeat(60)}`);
console.log(failures ? `FAIL  ${failures} check(s)` : 'PASS  receipts are honest and monotonic');
console.log('─'.repeat(60));
process.exit(failures ? 1 : 0);
