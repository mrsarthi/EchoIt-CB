/**
 * "Delete for me" hides locally and says so, and nothing silently vanishes.
 *
 *   npx tsx harness/hidden-messages.mts
 *
 * The risk here is not a crash, it is a false promise. A CRDT keeps what it is
 * given; there is no operation that removes an entry from the other person's
 * replica. An app that offered "delete for everyone" would be lying in the
 * most damaging direction — someone deletes a message believing it is gone and
 * it is sitting on a device they will never see again.
 *
 * So what is pinned here is that the warning exists, says the message stays on
 * the other device, and that hiding is filtering rather than removal.
 */

import {
  loadHidden,
  visibleMessages,
  describeDelete,
  joinForForward,
  DELETE_WARNING,
} from '../src/services/hidden-messages.js';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// The promise this feature must not make.
check('the warning says it is this device only', /this device only/i.test(DELETE_WARNING));
check('and that it stays on theirs', /other person's device/i.test(DELETE_WARNING));
check('and that nothing can be fully unsent', /ever be fully unsent/i.test(DELETE_WARNING));
check('it never claims to delete for everyone',
  !/everyone|both devices|permanently deleted/i.test(DELETE_WARNING), DELETE_WARNING);

const thread = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

check('nothing hidden leaves the thread untouched',
  visibleMessages(thread, new Set()).length === 3);
check('hiding one removes exactly one',
  visibleMessages(thread, new Set(['b'])).map((m) => m.id).join(',') === 'a,c');
check('order is preserved',
  visibleMessages(thread, new Set(['a'])).map((m) => m.id).join(',') === 'b,c');
check('hiding an id not present changes nothing',
  visibleMessages(thread, new Set(['zzz'])).length === 3);
check('hiding everything leaves an empty thread, not a crash',
  visibleMessages(thread, new Set(['a', 'b', 'c'])).length === 0);
check('the original array is not mutated', thread.length === 3);

// Storage is best-effort and must never throw into a render.
// `localStorage` does not exist in Node, which is exactly the "storage
// unavailable" case the app has to survive.
check('a missing localStorage yields an empty set rather than throwing',
  loadHidden('did:key:me', 'did:key:them').size === 0);

// Wording a person reads on a destructive button.
check('one message reads naturally', describeDelete(1) === 'Delete this message for me');
check('several are counted', describeDelete(3) === 'Delete 3 messages for me');
check('the button always says "for me"', /for me$/.test(describeDelete(1)) && /for me$/.test(describeDelete(9)));

// Forwarding.
check('one message forwards as itself, unquoted',
  joinForForward(['hello']) === 'hello');
check('several are separated readably',
  joinForForward(['one', 'two']) === 'one\n\ntwo');
check('empty entries are dropped rather than leaving gaps',
  joinForForward(['one', '   ', 'two']) === 'one\n\ntwo');
check('nothing selected forwards nothing', joinForForward([]) === '');

console.log(`\n${'─'.repeat(60)}`);
console.log(failures ? `FAIL  ${failures} check(s)` : 'PASS  deletion is local, and says so');
console.log('─'.repeat(60));
process.exit(failures ? 1 : 0);
