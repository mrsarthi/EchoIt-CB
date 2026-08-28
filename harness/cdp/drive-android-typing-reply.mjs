/**
 * Typing shows on the other phone; a chained reply arrives quoted.
 *
 *   node harness/cdp/drive-android-typing-reply.mjs <A> <B> [contactOnA] [contactOnB]
 *
 * Both features are only observable across two devices — a typing indicator
 * reports somebody *else*, and a reply is only interesting once the other side
 * renders the quotes. Neither can be checked on one phone, which is why they
 * shipped untested until now.
 *
 * The swipe is dispatched as real touch events rather than calling the handler,
 * so the gesture thresholds are exercised too: a swipe that is mostly vertical,
 * or too short, must not become a reply.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const PACKAGE = 'io.github.mrsarthi.echoit';
const A = process.argv[2];
const B = process.argv[3];
const CONTACT_ON_A = process.argv[4] ?? 'Phone A';
const CONTACT_ON_B = process.argv[5] ?? 'Phone B';

if (!A || !B) {
  console.error('Usage: node drive-android-typing-reply.mjs <A> <B> [contactOnA] [contactOnB]');
  process.exit(2);
}

const ADB = process.env.ADB
  ?? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk', 'platform-tools', 'adb.exe');
const adb = (serial, ...args) => execFileSync(ADB, ['-s', serial, ...args], { encoding: 'utf8' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} - ${name}${!ok && detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

async function attach(serial, port) {
  adb(serial, 'shell', 'am', 'start', '-n', `${PACKAGE}/.MainActivity`);
  await wait(2500);
  const pid = adb(serial, 'shell', 'pidof', '-s', PACKAGE).trim();
  if (!pid) throw new Error(`${PACKAGE} not running on ${serial}`);
  adb(serial, 'forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);

  const list = await (await fetch(`http://localhost:${port}/json`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error(`no page on ${serial} — debug build?`);
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
      res(m.result?.result?.value);
    };
    ws.addEventListener('message', h);
    setTimeout(() => res('<timeout>'), 30000);
    ws.send(JSON.stringify({
      id: mid, method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }));
  });
  return { evaluate, back: () => adb(serial, 'shell', 'input', 'keyevent', '4') };
}

async function openConversation(phone, name) {
  const inChat = async () => await phone.evaluate("Boolean(document.querySelector('input[type=file]'))");

  // Back out of whatever is open. Reported as already-in-a-conversation on one
  // phone, where tapping the Chats tab does not leave a chat on a narrow
  // layout, so the contact row was simply not on screen to be found.
  for (let i = 0; i < 4 && (await inChat()); i++) { phone.back(); await wait(1800); }

  // Already open and unable to leave is worth saying plainly rather than
  // failing later on a missing row.
  if (await inChat()) return 'still in a conversation — back did not leave it';
  await phone.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.innerText||'').trim().startsWith('Chats'));
    if (b) b.click();
  })()`);
  await wait(1200);
  return phone.evaluate(`(async () => {
    const leaf = [...document.querySelectorAll('*')]
      .find((e) => e.children.length === 0 && (e.textContent||'').trim() === ${JSON.stringify(name)});
    if (!leaf) return 'contact not found';
    leaf.click();
    await new Promise((r) => setTimeout(r, 1200));
    return document.querySelector('input[type=file]') ? 'opened' : 'could not open';
  })()`);
}

/** Type into the composer the way a person does, so onTyping fires per key. */
const typeInto = (text) => `(async () => {
  const ta = document.querySelector('textarea');
  if (!ta) return 'no composer';
  const set = (v) => {
    const setter = Object.getOwnPropertyDescriptor(ta.constructor.prototype, 'value').set;
    setter.call(ta, v);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const target = ${JSON.stringify(text)};
  for (let i = 1; i <= target.length; i++) {
    set(target.slice(0, i));
    await new Promise((r) => setTimeout(r, 90));
  }
  return ta.value;
})()`;

console.log('▸ Attaching');
const a = await attach(A, 9800);
const b = await attach(B, 9801);
/*
 * Setup must succeed or the run stops.
 *
 * A previous run reported "contact not found" for B and then passed every
 * check anyway — B happened to be in the right conversation already, so the
 * assertions were true by luck. Had it been in the wrong one, or none, the
 * suite would still have printed green.
 */
const openedA = await openConversation(a, CONTACT_ON_A);
const openedB = await openConversation(b, CONTACT_ON_B);
console.log('  A:', openedA);
console.log('  B:', openedB);

for (const [label, result] of [['A', openedA], ['B', openedB]]) {
  if (result !== 'opened') {
    console.error(`
Could not open the conversation on ${label}: ${result}`);
    console.error('Refusing to report on a screen that is not the one under test.');
    process.exit(2);
  }
}
await wait(3000);

// ── Typing ─────────────────────────────────────────────────────────────────
console.log('\n▸ A types, B should see it');
const activity = `(() => {
  const t = document.body.innerText;
  return (t.match(/typing…|Online|last seen[^\\n]*/) || [])[0] || null;
})()`;

console.log('  B before:', await b.evaluate(activity));
void a.evaluate(typeInto('hello there friend'));

let sawTyping = null;
for (let i = 0; i < 8; i++) {
  await wait(700);
  const seen = await b.evaluate(activity);
  if (seen === 'typing…') { sawTyping = `after ${(i + 1) * 700}ms`; break; }
}
check('B sees A typing', Boolean(sawTyping), 'the indicator never appeared');
if (sawTyping) console.log('   ', sawTyping);

// It has to stop on its own — there is no "stopped" message.
await wait(7000);
const afterIdle = await b.evaluate(activity);
check(
  'the indicator expires once A stops',
  afterIdle !== 'typing…',
  `still showing "${afterIdle}" — a latched indicator is worse than none`,
);

// ── Reply ──────────────────────────────────────────────────────────────────
console.log('\n▸ A swipes two messages and replies to both');

const swipe = (index) => `(async () => {
  const rows = [...document.querySelectorAll('[data-message-id]')];
  const row = rows[rows.length - ${index}];
  if (!row) return 'no row ' + ${index};
  const r = row.getBoundingClientRect();
  const y = Math.round(r.top + r.height / 2);
  const x0 = Math.round(r.left + 12);
  const touch = (type, x) => row.dispatchEvent(new TouchEvent(type, {
    bubbles: true, cancelable: true,
    touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: row, clientX: x, clientY: y })],
    changedTouches: [new Touch({ identifier: 1, target: row, clientX: x, clientY: y })],
  }));
  touch('touchstart', x0);
  for (let dx = 10; dx <= 70; dx += 10) { touch('touchmove', x0 + dx); await new Promise((r2) => setTimeout(r2, 40)); }
  touch('touchend', x0 + 70);
  await new Promise((r2) => setTimeout(r2, 400));
  return document.body.innerText.includes('Replying to') ? 'chained' : 'no chain shown';
})()`;

console.log('  swipe 1:', await a.evaluate(swipe(1)));
console.log('  swipe 2:', await a.evaluate(swipe(2)));

const chainLabel = await a.evaluate(`(() => (document.body.innerText.match(/Replying to [^\\n]*/) || [])[0] || null)()`);
console.log('  chain:', chainLabel);
check('two messages are chained', chainLabel === 'Replying to 2 messages', `saw "${chainLabel}"`);

const marker = `reply-${Date.now()}`;
await a.evaluate(typeInto(marker));
await a.evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Send message');
  if (b) b.click();
  return Boolean(b);
})()`);
await wait(2000);

const chainGone = await a.evaluate(`(() => !document.body.innerText.includes('Replying to'))()`);
check('the chain clears after sending', chainGone === true);

console.log('\n▸ B receives it');
let received = null;
for (let i = 0; i < 12; i++) {
  await wait(2500);
  received = JSON.parse(await b.evaluate(`JSON.stringify((() => {
    const text = document.body.innerText;
    return {
      hasMarker: text.includes(${JSON.stringify(marker)}),
      quotes: document.querySelectorAll('[data-message-id] div[style*="border-left"]').length,
      leaked: text.includes('echoit:reply:'),
    };
  })())`));
  if (received.hasMarker) break;
}
console.log(' ', JSON.stringify(received));
check('the reply arrives', Boolean(received?.hasMarker));
check(
  'no machine text reaches the reader',
  received?.leaked === false,
  'the control line carrying the references was displayed',
);
check('the quoted messages are shown', (received?.quotes ?? 0) >= 2, `${received?.quotes ?? 0} quote block(s)`);

console.log(`\n${'─'.repeat(64)}`);
if (failures.length) {
  console.log(`FAIL  ${failures.length} check(s) failed:`);
  for (const f of failures) console.log(`        - ${f}`);
} else {
  console.log('PASS  typing shows across devices, and a chained reply arrives quoted');
}
console.log('─'.repeat(64));
process.exit(failures.length ? 1 : 0);
