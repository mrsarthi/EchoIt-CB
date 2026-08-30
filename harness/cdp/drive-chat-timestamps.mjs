/**
 * The timestamp in a bubble never sits on top of the message.
 *
 *   node harness/cdp/drive-chat-timestamps.mjs <serial> [peer] [scales]
 *   node harness/cdp/drive-chat-timestamps.mjs QSXCK... "Phone B" 1.0,1.3
 *
 * ## What is fragile here
 *
 * The time sits in the bottom-right corner of the bubble the way WhatsApp does
 * it, and that layout is a trick: one copy is positioned absolutely in the
 * corner, and an identical hidden copy sits inline at the end of the text so
 * the last line stops short by exactly the right amount.
 *
 * It works only while the two copies are the same width. Change the font size
 * of one, give the corner a token that scales differently from the spacer, or
 * add anything to one and not the other, and the text runs underneath the
 * clock. Nothing throws; it just looks like a rendering glitch.
 *
 * The first attempt was a float instead, which was worse and passed every test
 * there was: a float pins to the *top* right, so a message that wrapped put
 * its timestamp 137px above the bottom of its own bubble. That was found by
 * looking at a phone, which is the reason this file exists.
 *
 * ## What it refuses to do
 *
 * Report "clean" without having measured anything. A conversation that did not
 * open, or a screen with no bubbles on it, is reported as a refusal -- a
 * checker that passes when it did no work is worse than no checker.
 *
 * It changes the system font scale and puts it back, including on Ctrl-C.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const PACKAGE = 'io.github.mrsarthi.echoit';
const SERIAL = process.argv[2];
const PEER = process.argv[3] ?? 'Phone B';
const SCALES = (process.argv[4] ?? '1.0,1.3').split(',');

if (!SERIAL) {
  console.error('Usage: node drive-chat-timestamps.mjs <serial> [peer] [scales]');
  process.exit(2);
}

const ADB = process.env.ADB
  ?? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk', 'platform-tools', 'adb.exe');
const adb = (...args) => execFileSync(ADB, ['-s', SERIAL, ...args], { encoding: 'utf8' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function attach(port) {
  let pid = '';
  try { pid = adb('shell', 'pidof', '-s', PACKAGE).trim(); } catch { pid = ''; }
  if (!pid) throw new Error(`${PACKAGE} is not running`);
  adb('forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
  const list = await (await fetch(`http://localhost:${port}/json`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page — debug build?');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  let id = 0;
  const evaluate = (expression) => new Promise((res) => {
    const mid = ++id;
    const h = (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== mid) return;
      ws.removeEventListener('message', h);
      res(m.result && m.result.result ? m.result.result.value : undefined);
    };
    ws.addEventListener('message', h);
    setTimeout(() => res(undefined), 25000);
    ws.send(JSON.stringify({
      id: mid,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }));
  });
  return { evaluate, close: () => ws.close() };
}

/**
 * Open a conversation by its row.
 *
 * Matching the first element whose text starts with the name finds the list
 * *container*, whose centre lands in the gap between two rows -- so the click
 * goes nowhere and the run reports "no composer" rather than admitting it
 * never opened anything. The tightest match is the row.
 */
const OPEN = (label) => `JSON.stringify((function(){
  var best = null;
  var els = document.querySelectorAll('div,button,li,article');
  for (var i = 0; i < els.length; i++) {
    var t = (els[i].innerText || '').trim();
    if (t.indexOf(${JSON.stringify(label)}) !== 0 || t.length > 400) continue;
    var r = els[i].getBoundingClientRect();
    if (r.height < 30 || r.width < 200) continue;
    if (!best || r.height < best.rect.height) best = { el: els[i], rect: r };
  }
  if (!best) return { ok: false };
  var r = best.rect;
  var hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) || best.el;
  var opts = { bubbles: true, cancelable: true, composed: true };
  hit.dispatchEvent(new PointerEvent('pointerdown', opts));
  hit.dispatchEvent(new PointerEvent('pointerup', opts));
  hit.dispatchEvent(new MouseEvent('click', opts));
  return { ok: true };
})())`;

/*
 * Overlap is measured against the text's own rectangles, not with
 * `elementFromPoint`.
 *
 * The first version of this asked what was under the middle of the clock, and
 * the answer is always the clock: it is absolutely positioned, so it is on top
 * by construction. That check could not fail, and did not -- including on a
 * page that had been deliberately broken in front of it.
 *
 * A `Range` over the bubble's own text nodes gives one rectangle per line of
 * the message. If any of them intersects the clock, the text is running
 * underneath it. Proven both ways on a device: nothing on the shipped layout,
 * every bubble once the corner is shoved 80px out of place.
 */
const PROBE = `JSON.stringify((function(){
  var problems = [], checked = 0;

  function lineRects(bubble) {
    // Only the message's own text. The hidden spacer and the clock are
    // elements, and a quoted reply is its own block, so none of them are here.
    var rects = [];
    for (var n = bubble.firstChild; n; n = n.nextSibling) {
      if (n.nodeType !== 3 || !n.nodeValue || !n.nodeValue.trim()) continue;
      var range = document.createRange();
      range.selectNodeContents(n);
      var list = range.getClientRects();
      for (var i = 0; i < list.length; i++) rects.push(list[i]);
    }
    return rects;
  }

  var spans = document.querySelectorAll('span');
  for (var s = 0; s < spans.length; s++) {
    var clockEl = spans[s];
    var cs = getComputedStyle(clockEl);
    if (cs.position !== 'absolute' || cs.visibility === 'hidden') continue;
    if (!/^[0-9]{1,2}:[0-9]{2}/.test((clockEl.innerText || '').trim())) continue;

    var bubble = clockEl.parentElement;
    var clock = clockEl.getBoundingClientRect();
    var box = bubble.getBoundingClientRect();

    // A bubble scrolled up behind the sticky header is not a layout fault, and
    // it is not counted either -- or the total would claim work that was
    // skipped.
    var scroller = bubble.closest('[style*="overflow"]') || document.body;
    var view = scroller.getBoundingClientRect();
    if (clock.top < view.top || clock.bottom > view.bottom) continue;

    checked++;

    if (clock.right > box.right + 1 || clock.bottom > box.bottom + 1 || clock.left < box.left - 1) {
      problems.push({ time: clockEl.innerText.trim(), why: 'the clock is outside its bubble' });
      continue;
    }

    var rects = lineRects(bubble);
    for (var r = 0; r < rects.length; r++) {
      var t = rects[r];
      var overlapX = Math.min(t.right, clock.right) - Math.max(t.left, clock.left);
      var overlapY = Math.min(t.bottom, clock.bottom) - Math.max(t.top, clock.top);
      if (overlapX > 1 && overlapY > 1) {
        problems.push({
          time: clockEl.innerText.trim(),
          why: 'message text runs under the clock',
          covering: Math.round(overlapX) + 'x' + Math.round(overlapY) + 'px'
        });
        break;
      }
    }
  }
  return { checked: checked, problems: problems };
})())`;

const original = adb('shell', 'settings', 'get', 'system', 'font_scale').trim();
const restore = () => {
  if (original && original !== 'null') {
    adb('shell', 'settings', 'put', 'system', 'font_scale', original);
  }
};
process.on('SIGINT', () => { restore(); process.exit(130); });

let failures = 0;
let measured = 0;

try {
  for (const scale of SCALES) {
    adb('shell', 'settings', 'put', 'system', 'font_scale', scale);
    // The webview is recreated when the configuration changes, so reattach
    // rather than reuse a socket pointing at the old one.
    adb('shell', 'am', 'force-stop', PACKAGE);
    adb('shell', 'am', 'start', '-n', `${PACKAGE}/.MainActivity`);
    await wait(18000);

    const session = await attach(9930 + SCALES.indexOf(scale));

    // A cold start needs longer than a tab switch: the list is empty until the
    // client is up, so "no row" straight away is a slow launch and not a
    // missing conversation.
    let opened = { ok: false };
    for (let tries = 0; tries < 8 && !opened.ok; tries += 1) {
      const raw = await session.evaluate(OPEN(PEER));
      opened = typeof raw === 'string' ? JSON.parse(raw) : { ok: false };
      if (!opened.ok) await wait(4000);
    }
    await wait(4000);

    if (!opened.ok) {
      console.log(`  ${scale}  REFUSING — never opened the conversation with ${PEER}`);
      failures += 1;
      session.close();
      continue;
    }

    const raw = await session.evaluate(PROBE);
    session.close();
    if (typeof raw !== 'string') {
      console.log(`  ${scale}  REFUSING — the probe did not answer`);
      failures += 1;
      continue;
    }

    const result = JSON.parse(raw);
    measured += result.checked;
    if (result.checked === 0) {
      console.log(`  ${scale}  REFUSING — no bubbles in view, so nothing was checked`);
      failures += 1;
    } else if (result.problems.length === 0) {
      console.log(`  ${scale}  clean (${result.checked} bubbles)`);
    } else {
      console.log(`  ${scale}  ${result.problems.length} of ${result.checked} bubbles wrong:`);
      for (const p of result.problems.slice(0, 5)) {
        console.log(`      ${p.time} — ${p.why}${p.covering ? ` ("${p.covering}")` : ''}`);
      }
      failures += 1;
    }
  }
} finally {
  restore();
  console.log(`\nfont_scale restored to ${original}`);
}

console.log('─'.repeat(64));
if (failures) {
  console.log('FAIL  the timestamp corner is not holding its place');
} else {
  console.log(`PASS  ${measured} bubbles, no text under the clock at ${SCALES.join(', ')}`);
}
console.log('─'.repeat(64));
process.exit(failures ? 1 : 0);
