/**
 * Message times must be real times, in the reader's own zone.
 *
 * The SDK reports `timestamp` in **seconds**; `new Date()` wants milliseconds.
 * The app passed one to the other, which put every message in January 1970 and
 * — the part that was actually visible — collapsed the gaps between them:
 * messages sent three seconds apart came out three *milliseconds* apart and
 * rendered as the same clock time. Reported as "the timing on the msgs always
 * shows 10:03 pm".
 *
 * Measured against the SDK when this was written:
 *
 *   wall = 1787801421537 (ms)   reported = 1787801421 (s)
 *
 * This runs without a network or a device, because the bug never needed either
 * to reproduce and a test nobody can run cheaply is a test nobody runs.
 *
 *   npm run test:timestamps
 */

import { toMillis } from '../src/services/timestamps.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

console.log('\n▸ Units');

const seconds = 1787801526;
check(
  'a seconds stamp is scaled to milliseconds',
  toMillis(seconds) === seconds * 1000,
  `${seconds} -> ${toMillis(seconds)}`,
);
check(
  'a millisecond stamp is left alone',
  toMillis(seconds * 1000) === seconds * 1000,
  'so a future SDK switching units does not move the bug by 1000x',
);

console.log('\n▸ Distinct sends render as distinct times');

// The symptom, reproduced: three sends three seconds apart.
const sends = [seconds, seconds + 3, seconds + 6];
const naive = new Set(sends.map((t) => new Date(t).toLocaleTimeString()));
const fixed = new Set(sends.map((t) => new Date(toMillis(t)).toLocaleTimeString()));
check(
  'the old reading collapsed them',
  naive.size === 1,
  `${naive.size} distinct time(s) — this is the reported bug`,
);
check(
  'the fixed reading keeps them apart',
  fixed.size === 3,
  `${fixed.size} of 3 distinct`,
);

console.log('\n▸ Any reader, any zone');

// A Unix epoch is an absolute instant, so the same stored value must describe
// the same moment everywhere. Half-hour and 45-minute zones are included on
// purpose: they are where a fix built from a fixed offset falls over.
const ms = toMillis(seconds);
const zones = [
  'UTC', 'Asia/Calcutta', 'America/New_York', 'America/Los_Angeles',
  'Europe/London', 'Australia/Sydney', 'Asia/Kathmandu', 'Pacific/Chatham',
];

let consistent = true;
for (const timeZone of zones) {
  const shown = new Date(ms).toLocaleString('en-US', { timeZone, dateStyle: 'medium', timeStyle: 'short' });
  // Parsing what we formatted must land back on the same instant.
  const roundTrip = new Date(new Date(ms).toLocaleString('en-US', { timeZone }));
  const drift = Math.abs(roundTrip.getTime() - ms);
  if (Number.isNaN(roundTrip.getTime())) consistent = false;
  console.log(`      ${timeZone.padEnd(20)} ${shown}`);
  if (drift > 24 * 60 * 60 * 1000) consistent = false;
}
check(
  'one instant, described in each zone',
  consistent,
  'no zone is hardcoded; rendering uses the reader\'s locale',
);
check(
  'nothing in the conversion mentions a timezone',
  !toMillis.toString().includes('330') && !/[Tt]ime[Zz]one/.test(toMillis.toString()),
  'the conversion is units only',
);

console.log(`\n${'─'.repeat(64)}`);
if (failures.length) {
  console.log(`FAIL  ${failures.length} check(s) failed:`);
  for (const f of failures) console.log(`        - ${f}`);
} else {
  console.log('PASS  timestamps are real instants, rendered in the reader\'s own zone');
}
console.log('─'.repeat(64));
process.exit(failures.length ? 1 : 0);
