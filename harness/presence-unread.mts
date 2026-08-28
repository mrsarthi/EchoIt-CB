/**
 * Unread counts, ordering, and presence phrasing.
 *
 * Runs without a network or a device, because none of this needs either to be
 * wrong — and the last three UI defects here were all found by a person using
 * the app rather than by anything automated.
 *
 * The unread UI has existed since August and has never rendered a number:
 * `unreadCount` was hardcoded `0` in `AppShell`, so the branch drawing it was
 * dead. Built and never fed. These are the assertions that would have caught
 * that.
 *
 *   npm run test:presence
 */

import { presenceFrom, describePresence, ONLINE_WINDOW_MS, HEARTBEAT_INTERVAL_MS } from '../src/services/presence.js';
import { countUnread, lastInboundAt } from '../src/services/unread.js';
import {
  newestOf,
  lastActivityOf,
  orderByRecency,
} from '../src/services/conversation-order.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

const ME = 'did:key:me';
const THEM = 'did:key:them';
const now = Date.parse('2026-08-27T12:00:00Z');
const ago = (ms: number) => now - ms;

console.log('\n▸ Unread counts');

const thread = [
  { authorDid: THEM, timestamp: ago(50_000) },
  { authorDid: ME, timestamp: ago(40_000) },
  { authorDid: THEM, timestamp: ago(30_000) },
  { authorDid: THEM, timestamp: ago(20_000) },
];

check(
  'everything from the peer counts when nothing was read',
  countUnread(thread, ME, undefined) === 3,
  `${countUnread(thread, ME, undefined)} of 3 inbound`,
);
check(
  'only what arrived after the mark counts',
  countUnread(thread, ME, ago(35_000)) === 2,
);
check(
  'your own messages never count',
  countUnread([{ authorDid: ME, timestamp: now }], ME, 0) === 0,
  'otherwise the badge climbs as you type',
);
check(
  'a fully read thread shows nothing',
  countUnread(thread, ME, now) === 0,
);

console.log('\n▸ Ordering');

/*
 * The real functions, not a copy of them.
 *
 * This block used to redeclare the comparator inline and assert against its own
 * copy, so it would have passed with the app's ordering deleted entirely. It
 * proved the duplicate worked.
 */
const rows = [
  { name: 'never written to', lastActivityAt: undefined as number | undefined },
  { name: 'yesterday', lastActivityAt: ago(26 * 60 * 60 * 1000) },
  { name: 'just now', lastActivityAt: ago(1000) },
];
const ordered = orderByRecency(rows);
check(
  'the most recent conversation comes first',
  ordered[0].name === 'just now',
  ordered.map((r) => r.name).join(' → '),
);
check(
  'a contact never written to sorts last, not first',
  ordered[ordered.length - 1].name === 'never written to',
  'undefined compared numerically would put them at the top',
);

// The reported symptom — rows sitting in the order contacts were added — is
// exactly what an all-undefined sort key produces, because a stable sort leaves
// equal elements where they are. That is what a chat list looks like in the
// moment before history has loaded.
const unloaded = ['first', 'second', 'third'].map((name) => ({
  name,
  lastActivityAt: undefined as number | undefined,
}));
check(
  'with no history loaded, the order is stable rather than scrambled',
  orderByRecency(unloaded).map((r) => r.name).join() === 'first,second,third',
  'a comparator returning NaN would leave this unspecified',
);

// Threads are normally ascending, but a live arrival is appended in the order
// it turns up: a message that syncs late lands at the END while being OLDER
// than its neighbour. The row's time, preview and position all read from this,
// so taking the last element would show one time and sort by another.
const outOfOrder = [{ timestamp: 5_000 }, { timestamp: 9_000 }, { timestamp: 7_000 }];
check(
  'the newest message is found by time, not by position',
  newestOf(outOfOrder)?.timestamp === 9_000,
  `got ${newestOf(outOfOrder)?.timestamp}, last element is ${outOfOrder[outOfOrder.length - 1].timestamp}`,
);
check(
  'an empty conversation has no activity time',
  lastActivityOf([]) === undefined,
  'zero would give a never-used contact a claim on the top of the list',
);

console.log('\n▸ Presence');

check(
  'a peer heard from moments ago is online',
  presenceFrom(ago(5_000), now).state === 'online',
);
check(
  'a peer past the window is offline, not unknown',
  presenceFrom(ago(ONLINE_WINDOW_MS + 1000), now).state === 'offline',
);
check(
  'a peer never heard from is unknown, not offline',
  presenceFrom(undefined, now).state === 'unknown',
  'so a new contact does not read as "last seen 56 years ago"',
);

check(
  'the online window fits the heartbeat interval',
  ONLINE_WINDOW_MS > HEARTBEAT_INTERVAL_MS * 2 && ONLINE_WINDOW_MS < HEARTBEAT_INTERVAL_MS * 3,
  `${ONLINE_WINDOW_MS / 1000}s window against a ${HEARTBEAT_INTERVAL_MS / 1000}s beat -- `
  + 'one dropped beat must not blink the dot off, and a departed peer must not linger',
);

console.log('\n▸ Phrasing');

const phrase = (msAgo: number | undefined) => describePresence(presenceFrom(msAgo === undefined ? undefined : ago(msAgo), now), now);

// Fixed durations, deliberately not derived from ONLINE_WINDOW_MS. This block
// tests how a gap is *worded*, not where the online threshold sits, and tying
// the two together meant shortening the window (2min -> 75s, once heartbeats
// made that honest) failed a phrasing test whose meaning had not changed.
const cases: Array<[string, string]> = [
  [phrase(5_000), 'Online'],
  [phrase(2 * 60 * 1000 + 10_000), 'last seen 2 minutes ago'],
  [phrase(60 * 60 * 1000), 'last seen 1 hour ago'],
  [phrase(5 * 60 * 60 * 1000), 'last seen 5 hours ago'],
  [phrase(3 * 24 * 60 * 60 * 1000), 'last seen 3 days ago'],
];
for (const [actual, expected] of cases) {
  check(`"${expected}"`, actual === expected, actual === expected ? '' : `got "${actual}"`);
}

check(
  'an unknown peer gets an empty line, not a placeholder',
  phrase(undefined) === '',
  'an empty slot says nothing; "last seen unknown" says something false-sounding',
);
check(
  'singular and plural are both handled',
  phrase(60 * 60 * 1000).includes('1 hour ago') && phrase(2 * 60 * 60 * 1000).includes('2 hours ago'),
);

console.log('\n▸ Newest inbound');

check(
  'the newest inbound message wins, regardless of order',
  lastInboundAt(
    [
      { authorDid: THEM, timestamp: ago(10_000) },
      { authorDid: THEM, timestamp: ago(90_000) },
      { authorDid: ME, timestamp: now },
    ],
    ME,
  ) === ago(10_000),
  'and your own newer message does not count as hearing from them',
);

console.log(`\n${'─'.repeat(64)}`);
if (failures.length) {
  console.log(`FAIL  ${failures.length} check(s) failed:`);
  for (const f of failures) console.log(`        - ${f}`);
} else {
  console.log('PASS  unread, ordering, and presence behave');
}
console.log('─'.repeat(64));
process.exit(failures.length ? 1 : 0);
