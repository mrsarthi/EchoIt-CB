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

import { presenceFrom, describePresence, ONLINE_WINDOW_MS } from '../src/services/presence.js';
import { countUnread, lastInboundAt } from '../src/services/unread.js';

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

// The comparator AppShell sorts by, applied to the case that motivated it.
const rows = [
  { name: 'never written to', lastActivityAt: undefined as number | undefined },
  { name: 'yesterday', lastActivityAt: ago(26 * 60 * 60 * 1000) },
  { name: 'just now', lastActivityAt: ago(1000) },
];
const ordered = [...rows].sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
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

console.log('\n▸ Phrasing');

const phrase = (msAgo: number | undefined) => describePresence(presenceFrom(msAgo === undefined ? undefined : ago(msAgo), now), now);

const cases: Array<[string, string]> = [
  [phrase(5_000), 'Online'],
  [phrase(ONLINE_WINDOW_MS + 10_000), 'last seen 2 minutes ago'],
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
