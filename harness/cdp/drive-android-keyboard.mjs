/**
 * The soft keyboard must not leave dead space in the app.
 *
 * This exists because the same area broke twice and the second break was
 * invisible to the first test.
 *
 *  1. The chat header slid under the status bar with the keyboard open. Fixed
 *     by sizing #root to `visualViewport.height`, and verified by measuring the
 *     header — while the viewport happened to be un-panned.
 *  2. Scrolling then revealed a grey band under the composer. The measurement
 *     that "proved" (1) had read `visualViewport.offsetTop: 0` and never
 *     scrolled, so the panned case never appeared.
 *
 * What matters is whether #root still covers the band the user can see:
 *
 *   broken -> the browser pans (visualViewport.offsetTop goes non-zero) while
 *             #root stays at layout-top 0, so it slides out of the visible band
 *             and exposes page background beneath the composer.
 *   fixed  -> #root spans offsetTop..offsetTop+visualViewport.height, however
 *             the browser chose to react, and keeps doing so while scrolling.
 *
 * That is asserted rather than "the header looks right", which was true in the
 * broken build too, and rather than "innerHeight === visualViewport.height",
 * which only described the native fix that was tried and abandoned.
 *
 *   node harness/cdp/drive-android-keyboard.mjs <deviceSerial> [contactName]
 *
 * Needs a **debug** APK (release builds expose no CDP endpoint) and one paired
 * contact to open a conversation with. Defaults to "Phone B".
 *
 * ## Why this restarts the app and forwards its own port
 *
 * Three separate runs reported failures that were really the test measuring the
 * wrong thing:
 *
 *  - the app had been sent to the background, and the webview happily answered
 *    CDP from behind the home screen with every geometry check passing;
 *  - the keyboard was still up from the previous run, so the "closed" baseline
 *    was taken with it open and "the keyboard opened" failed;
 *  - dismissing it with KEYCODE_ESCAPE closed the conversation as well, leaving
 *    no composer to tap.
 *
 * Owning the lifecycle is cheaper than defending against each of those.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const PACKAGE = 'io.github.mrsarthi.echoit';
const PORT = 9500;
const DEVICE = process.argv[2];
const CONTACT = process.argv[3] ?? 'Phone B';

if (!DEVICE) {
  console.error('Usage: node harness/cdp/drive-android-keyboard.mjs <deviceSerial> [contactName]');
  process.exit(2);
}

const ADB = process.env.ADB
  ?? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk', 'platform-tools', 'adb.exe');

const adb = (...args) => execFileSync(ADB, ['-s', DEVICE, ...args], { encoding: 'utf8' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The app must be the resumed activity, or the numbers describe nothing. */
function requireForeground(when) {
  const dump = adb('shell', 'dumpsys', 'activity', 'activities');
  const line = dump.split('\n').find((l) => /topResumedActivity|mResumedActivity/.test(l)) ?? '';
  if (!line.includes(PACKAGE)) {
    console.error(`\nEchoIt is not in the foreground ${when}.`);
    console.error(`  top activity: ${line.trim() || '(none reported)'}`);
    console.error('Refusing to report on a viewport nobody is looking at.');
    process.exit(2);
  }
}

console.log('▸ Restarting the app for a clean viewport');
adb('shell', 'am', 'force-stop', PACKAGE);
adb('shell', 'am', 'start', '-n', `${PACKAGE}/.MainActivity`);
await wait(15000);

const pid = adb('shell', 'pidof', '-s', PACKAGE).trim();
if (!pid) {
  console.error(`${PACKAGE} is not running after am start.`);
  process.exit(2);
}
adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`);
requireForeground('after restart');

const list = await (await fetch(`http://localhost:${PORT}/json`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error(`No page on ${PORT} — is this a debug build?`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let nextId = 0;
const evaluate = (expression) =>
  new Promise((resolve) => {
    const id = ++nextId;
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      ws.removeEventListener('message', onMessage);
      resolve(message.result?.result?.value);
    };
    ws.addEventListener('message', onMessage);
    setTimeout(() => resolve('<timeout>'), 15000);
    ws.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }));
  });

/** Everything the two failures above turned on, read in one go. */
const metrics = async () =>
  JSON.parse(await evaluate(`JSON.stringify((() => {
    const root = document.getElementById('root').getBoundingClientRect();
    return {
      innerHeight: window.innerHeight,
      vvHeight: Math.round(visualViewport.height),
      offsetTop: Math.round(visualViewport.offsetTop),
      rootTop: Math.round(root.top),
      rootBottom: Math.round(root.bottom),
      composerVisible: (() => {
        const el = [...document.querySelectorAll('input,textarea')]
          .find((i) => /Type a message/.test(i.placeholder));
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.bottom > 0 && r.bottom <= visualViewport.offsetTop + visualViewport.height + 1;
      })(),
    };
  })())`));

const failures = [];
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

// ── Open a conversation ─────────────────────────────────────────────────────
await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')]
    .find((x) => (x.innerText || '').trim().startsWith('Contacts'));
  if (b) b.click();
})()`);
await wait(2000);

const opened = await evaluate(`(() => {
  const leaf = [...document.querySelectorAll('*')]
    .find((e) => e.children.length === 0 && (e.textContent || '').trim() === ${JSON.stringify(CONTACT)});
  if (!leaf) return 'missing';
  let node = leaf;
  for (let i = 0; i < 6 && node; i++) {
    if (node.onclick || node.tagName === 'BUTTON') { node.click(); return 'opened'; }
    node = node.parentElement;
  }
  leaf.click();
  return 'opened';
})()`);
if (opened === 'missing') {
  console.error(`No contact named "${CONTACT}" on this device. Pass a name as argv[3].`);
  process.exit(2);
}
await wait(2500);

const closed = await metrics();
console.log('\n▸ Keyboard closed');
console.log(' ', JSON.stringify(closed));
if (closed.composerVisible === null) {
  console.error('No composer — the conversation did not open.');
  process.exit(2);
}

// ── Open the keyboard ───────────────────────────────────────────────────────
// A real touch. Synthetic focus over CDP does not raise the IME at all, so a
// test built on it measures an unchanged viewport and cannot tell a fixed build
// from a broken one.
const tapPoint = JSON.parse(await evaluate(`JSON.stringify((() => {
  const el = [...document.querySelectorAll('input,textarea')]
    .find((i) => /Type a message/.test(i.placeholder));
  const r = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return { x: Math.round((r.left + r.width / 2) * dpr), y: Math.round((r.top + r.height / 2) * dpr) };
})())`));

console.log(`  tapping composer at ${tapPoint.x},${tapPoint.y} (device px)`);
adb('shell', 'input', 'tap', String(tapPoint.x), String(tapPoint.y));
await wait(3500);
// A tap that misses the composer and lands in the gesture nav bar sends the app
// home instead. That happened while the composer was drawn under the nav bar.
requireForeground('after tapping the composer');

const open = await metrics();
console.log('\n▸ Keyboard open');
console.log(' ', JSON.stringify(open));

check(
  'the keyboard actually opened',
  open.vvHeight < closed.vvHeight,
  `visual viewport ${closed.vvHeight} -> ${open.vvHeight}`,
);
check(
  'the app covers the visible viewport',
  open.rootTop <= open.offsetTop + 1 && open.rootBottom >= open.offsetTop + open.vvHeight - 1,
  `root ${open.rootTop}..${open.rootBottom}, visible ${open.offsetTop}..${open.offsetTop + open.vvHeight}`,
);
check('the composer is on screen', open.composerVisible === true);

// ── Scroll: the step the earlier check skipped ──────────────────────────────
// A real swipe. Panning is something the browser does in response to touch, so
// a programmatic scrollTop would not reproduce the reported symptom.
adb('shell', 'input', 'swipe',
  String(tapPoint.x), String(Math.round(tapPoint.y * 0.4)),
  String(tapPoint.x), String(Math.round(tapPoint.y * 0.75)), '300');
await wait(2000);
requireForeground('after scrolling');

const scrolled = await metrics();
console.log('\n▸ Keyboard open, after scrolling');
console.log(' ', JSON.stringify(scrolled));

check(
  'the app still covers the visible viewport',
  scrolled.rootTop <= scrolled.offsetTop + 1
    && scrolled.rootBottom >= scrolled.offsetTop + scrolled.vvHeight - 1,
  `root ${scrolled.rootTop}..${scrolled.rootBottom}, `
    + `visible ${scrolled.offsetTop}..${scrolled.offsetTop + scrolled.vvHeight}`,
);
check('the composer is still on screen', scrolled.composerVisible === true);

console.log(`\n${'─'.repeat(64)}`);
if (failures.length) {
  console.log(`FAIL  ${failures.length} check(s) failed:`);
  for (const f of failures) console.log(`        - ${f}`);
} else {
  console.log('PASS  the app covers the visible area with the keyboard open, scrolled or not');
}
console.log('─'.repeat(64));
process.exit(failures.length ? 1 : 0);
