/**
 * Older messages load without losing the reader's place.
 *
 *   npm run test:history
 *
 * Runs headlessly: this is arithmetic about scroll positions and window sizes,
 * and a test that needs a phone to check arithmetic is a test nobody runs.
 *
 * The case that matters is the one that is invisible until it bites: prepending
 * older messages pushes everything down by their height, so a view that does
 * not compensate jumps backwards exactly when the reader asked for more.
 */

import {
  INITIAL_WINDOW,
  WINDOW_STEP,
  LOAD_MORE_THRESHOLD_PX,
  initialWindow,
  shouldLoadMore,
  grow,
  preservedScrollTop,
} from '../src/services/history-window.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} - ${name}${!ok && detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

console.log('\n▸ When to ask for more');

const fresh = initialWindow();
check(
  'near the top asks for more',
  shouldLoadMore(10, fresh, false),
  `threshold is ${LOAD_MORE_THRESHOLD_PX}px`,
);
check('far from the top does not', !shouldLoadMore(5000, fresh, false));
check(
  'already loading does not ask again',
  !shouldLoadMore(0, fresh, true),
  'otherwise every scroll event during a load queues another',
);
check(
  'a conversation with nothing older does not ask',
  !shouldLoadMore(0, { size: 120, hasMore: false }, false),
  'this is what stops an endless loop at the top of a short conversation',
);

console.log('\n▸ Growing the window');

const grown = grow(fresh, INITIAL_WINDOW);
check('the window grows by one step', grown.size === INITIAL_WINDOW + WINDOW_STEP, `${grown.size}`);
check(
  'a full response means there may be more',
  grown.hasMore,
  'as many came back as were asked for',
);

const exhausted = grow({ size: 60, hasMore: true }, 42);
check(
  'a short response means the end',
  !exhausted.hasMore,
  'fewer came back than asked for, so there is nothing older',
);
check(
  'a conversation shorter than the first window ends immediately',
  !grow(initialWindow(), 12).hasMore,
  'without this the top of a 12-message conversation asks forever',
);

console.log('\n▸ Keeping the reader in place');

// 40 older messages, 80px each, prepended above the viewport.
const before = { height: 4000, top: 120 };
const after = { height: 4000 + 40 * 80 };
const restored = preservedScrollTop(before.height, after.height, before.top);
check(
  'the view stays on the same message after a prepend',
  restored === before.top + (after.height - before.height),
  `scrollTop ${before.top} -> ${restored}`,
);
check(
  'the reader does not end up back at the top',
  restored > LOAD_MORE_THRESHOLD_PX,
  'landing back inside the threshold would immediately request another page',
);
check(
  'nothing moves when nothing was added',
  preservedScrollTop(4000, 4000, 900) === 900,
);

console.log(`\n${'─'.repeat(64)}`);
if (failures.length) {
  console.log(`FAIL  ${failures.length} check(s) failed:`);
  for (const f of failures) console.log(`        - ${f}`);
} else {
  console.log('PASS  older messages load without moving the reader');
}
console.log('─'.repeat(64));
process.exit(failures.length ? 1 : 0);
