/**
 * The nav badge counts conversations, and never the one you are reading.
 *
 *   npx tsx harness/nav-badges.mts
 *
 * Both navs have drawn a badge since they were written and neither had ever
 * shown one on a phone: `AppShell` called `BottomNav` with no counts at all,
 * so the props sat at their defaults of zero. `services/unread.ts` already
 * records the same omission happening twice with `unreadCount: 0`. UI that is
 * built and then never fed does not fail loudly, which is why it survives.
 *
 * So the counting is pinned here, away from the component that draws it.
 */

import { countWaitingConversations, countUnread } from '../src/services/unread.js';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const rows = [
  { id: 'a', unreadCount: 3 },
  { id: 'b', unreadCount: 0 },
  { id: 'c', unreadCount: 11 },
];

check('conversations are counted, not messages',
  countWaitingConversations(rows, null) === 2,
  `got ${countWaitingConversations(rows, null)} from 14 unread messages`);
check('the open conversation is excluded',
  countWaitingConversations(rows, 'a') === 1);
check('excluding a conversation with nothing unread changes nothing',
  countWaitingConversations(rows, 'b') === 2);
check('an unknown open id excludes nothing',
  countWaitingConversations(rows, 'zzz') === 2);
check('no conversations is zero, not NaN',
  countWaitingConversations([], null) === 0);
check('a missing count is treated as none',
  countWaitingConversations([{ id: 'x' }], null) === 0);
check('undefined open id behaves like none open',
  countWaitingConversations(rows, undefined) === 2);

/*
 * The per-row count feeding it. Its own rule — your own messages never count —
 * is what stops a badge climbing as you type, and it is the classic way this
 * is got wrong.
 */
const ME = 'did:key:me';
const thread = [
  { authorDid: ME, timestamp: 100 },
  { authorDid: 'did:key:them', timestamp: 200 },
  { authorDid: 'did:key:them', timestamp: 300 },
];
check('only their messages count', countUnread(thread, ME, 0) === 2);
check('your own never do', countUnread([{ authorDid: ME, timestamp: 9 }], ME, 0) === 0);
check('a read mark drops what came before it', countUnread(thread, ME, 200) === 1);
check('a mark past everything leaves nothing', countUnread(thread, ME, 999) === 0);

console.log(`\n${'─'.repeat(60)}`);
console.log(failures ? `FAIL  ${failures} check(s)` : 'PASS  badges count what they claim to count');
console.log('─'.repeat(60));
process.exit(failures ? 1 : 0);
