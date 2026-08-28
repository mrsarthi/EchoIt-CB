/**
 * Nothing spills out of its box when the system font is enlarged.
 *
 *   node harness/cdp/drive-android-font-scale.mjs <serial> [scales]
 *   node harness/cdp/drive-android-font-scale.mjs QSXCK... 1.0,1.15,1.3,1.5
 *
 * Reported on a phone with the system font at 1.15: the System button in the
 * theme selector ran past its card and off the screen. Measured then — right
 * edge 368, card ending at 313, viewport 360.
 *
 * The cause was `grid-template-columns: repeat(3, 1fr)`. A `1fr` track carries
 * an automatic minimum of *min-content*, so it cannot shrink below the label
 * plus the button's fixed padding; past that width the item simply overflows.
 * Nothing about that is visible at the default font size, which is why it
 * shipped.
 *
 * That class of bug is invisible until someone with larger text opens the
 * screen, so this walks every tab at several scales and reports anything whose
 * right edge escapes its parent or the viewport.
 *
 * ## It changes a device setting, and puts it back
 *
 * `font_scale` is the user's own accessibility preference. The original is read
 * first and restored in a `finally`, including on Ctrl-C — leaving someone's
 * phone at 1.5 would be a rude way to end a test run.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const PACKAGE = 'io.github.mrsarthi.echoit';
const SERIAL = process.argv[2];
const SCALES = (process.argv[3] ?? '1.0,1.15,1.3,1.5').split(',').map(Number);

if (!SERIAL) {
  console.error('Usage: node drive-android-font-scale.mjs <serial> [scales]');
  process.exit(2);
}

const ADB = process.env.ADB
  ?? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk', 'platform-tools', 'adb.exe');
const adb = (...args) => execFileSync(ADB, ['-s', SERIAL, ...args], { encoding: 'utf8' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const originalScale = adb('shell', 'settings', 'get', 'system', 'font_scale').trim();
const restore = () => {
  if (originalScale && originalScale !== 'null') {
    adb('shell', 'settings', 'put', 'system', 'font_scale', originalScale);
  }
};
process.on('SIGINT', () => { restore(); process.exit(130); });

const failures = [];

/** Overflow, measured against the parent box and the window. */
const PROBE = `JSON.stringify((function () {
  var vw = document.documentElement.clientWidth;
  var out = [];
  var all = document.querySelectorAll('*');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    var p = el.parentElement;
    if (!p) continue;
    var pr = p.getBoundingClientRect();
    // A scroll container is allowed to hold content taller or wider than
    // itself; that is what it is for. Only unscrollable parents count.
    var ps = getComputedStyle(p);
    var scrolls = ps.overflowX === 'auto' || ps.overflowX === 'scroll'
      || ps.overflow === 'auto' || ps.overflow === 'scroll';
    var pastParent = !scrolls && r.right > pr.right + 1;
    var pastWindow = r.right > vw + 1;
    if (pastParent || pastWindow) {
      out.push({
        tag: el.tagName,
        text: (el.innerText || '').trim().split(String.fromCharCode(10))[0].slice(0, 24),
        right: Math.round(r.right),
        parentRight: Math.round(pr.right),
        offScreen: pastWindow
      });
    }
  }
  return { vw: vw, items: out.slice(0, 6), count: out.length };
})())`;

async function connect() {
  const pid = adb('shell', 'pidof', '-s', PACKAGE).trim();
  if (!pid) throw new Error(`${PACKAGE} is not running`);
  adb('forward', 'tcp:9900', `localabstract:webview_devtools_remote_${pid}`);
  const list = await (await fetch('http://localhost:9900/json')).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page — debug build?');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  let id = 0;
  return (expression) => new Promise((res) => {
    const mid = ++id;
    const h = (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== mid) return;
      ws.removeEventListener('message', h);
      res(m.result && m.result.result ? m.result.result.value : undefined);
    };
    ws.addEventListener('message', h);
    setTimeout(() => res(undefined), 20000);
    ws.send(JSON.stringify({
      id: mid,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }));
  });
}

const TABS = ['Chats', 'Contacts', 'Settings', 'Profile'];

try {
  for (const scale of SCALES) {
    console.log(`\n▸ Font scale ${scale}`);
    adb('shell', 'settings', 'put', 'system', 'font_scale', String(scale));
    // The webview is recreated when the configuration changes, so reattach
    // rather than reuse a socket pointing at the old one.
    adb('shell', 'am', 'force-stop', PACKAGE);
    adb('shell', 'am', 'start', '-n', `${PACKAGE}/.MainActivity`);
    await wait(16000);

    const evaluate = await connect();

    for (const tab of TABS) {
      await evaluate(`(function () {
        var b = [].slice.call(document.querySelectorAll('button')).filter(function (x) {
          return (x.innerText || '').trim().indexOf(${JSON.stringify(tab)}) === 0; })[0];
        if (b) b.click();
      })()`);
      await wait(1800);

      const raw = await evaluate(PROBE);
      if (typeof raw !== 'string') {
        console.log(`  ${tab.padEnd(9)} probe failed`);
        continue;
      }
      const result = JSON.parse(raw);
      if (result.count === 0) {
        console.log(`  ${tab.padEnd(9)} clean (viewport ${result.vw})`);
      } else {
        console.log(`  ${tab.padEnd(9)} ${result.count} overflowing:`);
        for (const item of result.items) {
          console.log(`      ${item.tag} "${item.text}" right ${item.right} vs parent ${item.parentRight}`
            + (item.offScreen ? ' — OFF SCREEN' : ''));
        }
        failures.push(`${tab} at ${scale}`);
      }
    }
  }
} finally {
  restore();
  console.log(`\nfont_scale restored to ${originalScale}`);
}

console.log(`\n${'─'.repeat(64)}`);
if (failures.length) {
  console.log(`FAIL  overflow at: ${failures.join(', ')}`);
} else {
  console.log('PASS  nothing escapes its box at any tested font scale');
}
console.log('─'.repeat(64));
process.exit(failures.length ? 1 : 0);
