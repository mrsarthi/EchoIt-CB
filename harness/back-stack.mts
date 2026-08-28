/**
 * The back button goes to the topmost screen, and only that one.
 *
 *   npm run test:back
 *
 * Reported: zoomed into a photo, pressing the phone's back button "throws me
 * out to the chats page instead of the chat window where the image was
 * shared". Both the viewer and the app shell acted on one press.
 *
 * The viewer had a `{ capture: true }` listener calling
 * `stopImmediatePropagation`, on the assumption that capture runs first. For an
 * event dispatched **on `window`**, `window` is the target, and listeners on
 * the target run in registration order with the capture flag ignored — so the
 * shell, which mounts first, ran first.
 *
 * That is invisible in the code and easy to reassert, which is exactly why it
 * is asserted here rather than left to a comment.
 */

import { pushBackHandler, backHandlerCount } from '../src/services/back-stack.js';

// A window with just enough of the DOM event surface to dispatch on.
class FakeWindow {
  private listeners = new Map<string, Array<(e: unknown) => void>>();
  addEventListener(type: string, fn: (e: unknown) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, fn: (e: unknown) => void) {
    const list = this.listeners.get(type) ?? [];
    const at = list.indexOf(fn);
    if (at >= 0) list.splice(at, 1);
  }
  dispatchEvent(type: string) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn({ type });
  }
}

const fake = new FakeWindow();
(globalThis as unknown as { window: FakeWindow }).window = fake;
const press = () => fake.dispatchEvent('echoit:back');

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} - ${name}${!ok && detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

console.log('\n▸ One press, one handler');

const calls: string[] = [];

// The shell registers first, exactly as it does at runtime.
const releaseShell = pushBackHandler(() => { calls.push('shell'); return true; });
// The viewer opens on top of it.
const releaseViewer = pushBackHandler(() => { calls.push('viewer'); return true; });

press();
check(
  'the topmost handler claims the press',
  calls.join(',') === 'viewer',
  `ran: ${calls.join(',') || 'nothing'}`,
);
check(
  'the shell underneath does not also run',
  !calls.includes('shell'),
  'both running is the reported bug: the viewer closed AND the app navigated away',
);

console.log('\n▸ After the top screen closes');
calls.length = 0;
releaseViewer();
press();
check('the press falls through to the shell', calls.join(',') === 'shell', `ran: ${calls.join(',')}`);

console.log('\n▸ A handler that declines');
calls.length = 0;
const releaseDeclining = pushBackHandler(() => { calls.push('declined'); return false; });
press();
check(
  'a handler returning false passes the press down',
  calls.join(',') === 'declined,shell',
  `ran: ${calls.join(',')}`,
);
releaseDeclining();

console.log('\n▸ A handler that throws');
calls.length = 0;
const releaseThrowing = pushBackHandler(() => { throw new Error('broken'); });
press();
check(
  'a throwing handler does not strand the user',
  calls.join(',') === 'shell',
  'the press must still reach something that can navigate',
);
releaseThrowing();

console.log('\n▸ Cleanup');
releaseShell();
check('releasing removes the handler', backHandlerCount() === 0, `${backHandlerCount()} left`);
calls.length = 0;
press();
check('a press with nothing registered does nothing', calls.length === 0);

console.log(`\n${'─'.repeat(64)}`);
if (failures.length) {
  console.log(`FAIL  ${failures.length} check(s) failed:`);
  for (const f of failures) console.log(`        - ${f}`);
} else {
  console.log('PASS  back reaches the topmost screen and stops there');
}
console.log('─'.repeat(64));
process.exit(failures.length ? 1 : 0);
