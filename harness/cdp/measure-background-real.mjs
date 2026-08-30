/**
 * Is the app actually running when it is in the background, and does a message
 * sent to it arrive?
 *
 *   node harness/cdp/measure-background-real.mjs <receiver-serial> <sender-serial>
 *
 * ## Why this exists when a background test already did
 *
 * `test-background.mjs` drives `window.__echoit` — the bridge harness page, not
 * the app. It has none of the app's recovery machinery: no
 * `reconnectKnownContacts`, no `drainAfterReconnect`, no CRDT resync on
 * foregrounding. Its numbers are still quoted as the app's behaviour, and they
 * are not.
 *
 * ## The question this is really for
 *
 * The protocol runs in the webview; only byte movement is in Rust. Android
 * freezes cached processes. If the freeze takes the Rust threads with it, then
 * nothing app-side can receive while backgrounded and delivery needs a server
 * to hold messages. If the Rust threads keep running, a native spool could
 * accept and store envelopes with no server at all — which is a different
 * product, and a much smaller one to build.
 *
 * `/proc/<pid>/stat` answers it directly: fields 14 and 15 are utime and stime
 * in clock ticks. A frozen process accumulates neither. `pidof` returning a
 * number proves only that the process exists, which is what the earlier
 * measurement actually established.
 *
 * Nothing here is inferred from the app's own reports. CPU time comes from the
 * kernel, and delivery is judged by whether the text is on screen at the end.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const RECEIVER = process.argv[2];
const SENDER = process.argv[3];
const PACKAGE = 'io.github.mrsarthi.echoit';

if (!RECEIVER || !SENDER) {
  console.error('Usage: node measure-background-real.mjs <receiver-serial> <sender-serial>');
  process.exit(2);
}

const ADB = process.env.ADB
  ?? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk', 'platform-tools', 'adb.exe');
const adb = (serial, ...args) =>
  execFileSync(ADB, ['-s', serial, ...args], { encoding: 'utf8' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const pidOf = (serial) => adb(serial, 'shell', 'pidof', '-s', PACKAGE).trim();

/** Kernel-reported CPU time in ticks, and the scheduler state letter. */
function cpu(serial, pid) {
  const raw = adb(serial, 'shell', `cat /proc/${pid}/stat`).trim();
  // The process name can contain spaces inside parentheses; everything after
  // the closing paren is positional.
  const after = raw.slice(raw.lastIndexOf(')') + 2).split(/\s+/);
  return {
    state: after[0],
    utime: Number(after[11]),
    stime: Number(after[12]),
    threads: Number(after[17]),
  };
}

async function evaluate(serial, port, expression) {
  const pid = pidOf(serial);
  adb(serial, 'forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
  const targets = await (await fetch(`http://localhost:${port}/json`)).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error(`${serial}: no page target`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  const value = await new Promise((res) => {
    const handler = (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== 1) return;
      ws.removeEventListener('message', handler);
      res(m.result?.result?.value);
    };
    ws.addEventListener('message', handler);
    setTimeout(() => res(undefined), 20000);
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }));
  });
  ws.close();
  return value;
}

const send = (text) => evaluate(SENDER, 9700, `(function(){
  var t = document.querySelector('textarea[placeholder="Type a message..."]');
  if (!t) return 'no composer';
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
    .set.call(t, ${JSON.stringify(text)});
  t.dispatchEvent(new Event('input', { bubbles: true }));
  t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return 'sent';
})()`);

/**
 * Put the sender in the conversation before anything else.
 *
 * Without this the composer is not on screen, every send returns "no composer",
 * and the delivery column reads 0/4 — which looks exactly like total loss and
 * is actually nothing having been sent. That misreading is one edit away at
 * all times, so the run refuses rather than reporting it.
 */
async function openConversationOnSender() {
  const opened = await evaluate(SENDER, 9700, `(function(){
    if (document.querySelector('textarea[placeholder="Type a message..."]')) return 'already open';
    var tab = [].slice.call(document.querySelectorAll('button')).filter(function (b) {
      return (b.innerText || '').trim().indexOf('Chats') === 0
        || /Chats/.test(b.getAttribute('aria-label') || '');
    })[0];
    if (tab) tab.click();
    return 'went to Chats';
  })()`);
  await wait(3000);
  await evaluate(SENDER, 9700, `(function(){
    var rows = [].slice.call(document.querySelectorAll('button,li,div')).filter(function (e) {
      return e.getBoundingClientRect().height < 160 && (e.innerText || '').trim().length > 0;
    });
    var hit = rows.filter(function (e) { return /^Phone A/.test((e.innerText || '').trim()); })[0];
    if (hit) hit.click();
    return hit ? 'opened' : 'no row';
  })()`);
  await wait(4000);
  const ready = await evaluate(SENDER, 9700,
    `!!document.querySelector('textarea[placeholder="Type a message..."]')`);
  if (!ready) {
    throw new Error('sender is not in a conversation — every send would report "no composer" '
      + 'and the run would report total loss for the wrong reason');
  }
  console.log(`sender ready (${opened})`);
}

await openConversationOnSender();

const stamp = `bg-${Date.now().toString(36)}`;
const marks = [];

const pid = pidOf(RECEIVER);
if (!pid) throw new Error('receiver app is not running');
console.log(`receiver pid ${pid}\n`);

let previous = cpu(RECEIVER, pid);
console.log(`baseline (foreground): state=${previous.state} cpu=${previous.utime + previous.stime} ticks`);

// Background it with HOME, exactly as a person does.
adb(RECEIVER, 'shell', 'input', 'keyevent', 'KEYCODE_HOME');
console.log('HOME pressed\n');

for (const seconds of [10, 30, 90, 180]) {
  await wait(seconds * 1000 - (seconds === 10 ? 0 : 0));

  const now = pidOf(RECEIVER);
  if (!now) {
    console.log(`${seconds}s  PROCESS GONE — Android killed it`);
    break;
  }
  const sample = cpu(RECEIVER, now);
  const burned = (sample.utime + sample.stime) - (previous.utime + previous.stime);
  previous = sample;

  const text = `${stamp}-${seconds}`;
  let sent = 'skipped';
  try {
    sent = await send(text);
  } catch (e) {
    sent = `send failed: ${e.message}`;
  }
  marks.push({ seconds, text });

  console.log(`${String(seconds).padStart(3)}s  state=${sample.state} `
    + `cpu+${String(burned).padStart(4)} ticks  threads=${sample.threads}  send: ${sent}`);
}

console.log('\nforegrounding the receiver');
adb(RECEIVER, 'shell', 'am', 'start', '-n', `${PACKAGE}/.MainActivity`);
await wait(20000);

/*
 * Open the conversation before looking for the messages in it.
 *
 * Reading `document.body.innerText` on whatever screen the app happened to
 * resume onto reports every message as missing, which is indistinguishable
 * from total loss and is not it. The messages have to be looked for where they
 * would be.
 */
await evaluate(RECEIVER, 9701, `(function(){
  var tab = [].slice.call(document.querySelectorAll('button')).filter(function (b) {
    return (b.innerText || '').trim().indexOf('Chats') === 0
      || /Chats/.test(b.getAttribute('aria-label') || '');
  })[0];
  if (tab) tab.click();
  return 'chats';
})()`);
await wait(3000);
await evaluate(RECEIVER, 9701, `(function(){
  var rows = [].slice.call(document.querySelectorAll('button,li,div')).filter(function (e) {
    return e.getBoundingClientRect().height < 160;
  });
  var hit = rows.filter(function (e) { return /^Phone B/.test((e.innerText || '').trim()); })[0];
  if (hit) hit.click();
  return hit ? 'opened' : 'no row';
})()`);
await wait(6000);

const inConversation = await evaluate(RECEIVER, 9701,
  `!!document.querySelector('textarea[placeholder="Type a message..."]')`);
if (!inConversation) {
  console.log('');
  console.log('WARNING: could not open the conversation on the receiver.');
  console.log('The delivery column below is not evidence of anything.');
}

const body = await evaluate(RECEIVER, 9701,
  'document.body.innerText') ?? '';

console.log('\ndelivered after foregrounding:');
let arrived = 0;
for (const mark of marks) {
  const here = body.includes(mark.text);
  if (here) arrived += 1;
  console.log(`  ${here ? 'YES' : 'NO '}  ${mark.text}`);
}

console.log(`\n${'-'.repeat(64)}`);
console.log(`${arrived}/${marks.length} arrived. CPU ticks while backgrounded is the`);
console.log('number that decides whether a native spool is even possible.');
console.log('-'.repeat(64));
