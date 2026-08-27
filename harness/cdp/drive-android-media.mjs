/**
 * A photo, sent from one phone and opened on the other.
 *
 *   node harness/cdp/drive-android-media.mjs <senderSerial> <receiverSerial> [senderContact] [receiverContact]
 *
 * ## Why a synthetic File rather than the picker
 *
 * The paperclip opens Android's native file chooser, which CDP cannot drive —
 * it is not part of the page. So the file is built in the page (canvas → blob →
 * File) and handed to the input through DataTransfer, which is what the chooser
 * would have done. Everything after that is the real path: real bytes, real
 * blobs.put, real transfer over QUIC, real render.
 *
 * The image is drawn rather than a flat colour, so a truncated or misassembled
 * transfer cannot accidentally compare equal.
 *
 * ## Counting img elements is not enough
 *
 * A broken image is still an img element. An earlier version counted them and
 * would have passed while the sender showed a broken-image icon — the object
 * URL had been revoked on unmount, and `fetch` on it failed with naturalWidth
 * 0. So "rendered" means complete AND naturalWidth > 0.
 *
 * That bug only appeared after leaving the conversation and returning, which is
 * why that round trip is a check here rather than an afterthought.
 *
 * Needs debug APKs on both phones and an existing conversation between them.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const PACKAGE = 'io.github.mrsarthi.echoit';
const SENDER = process.argv[2];
const RECEIVER = process.argv[3];
const SENDER_CONTACT = process.argv[4] ?? 'Phone A';
const RECEIVER_CONTACT = process.argv[5] ?? 'Phone B';

if (!SENDER || !RECEIVER) {
  console.error('Usage: node drive-android-media.mjs <sender> <receiver> [senderContact] [receiverContact]');
  process.exit(2);
}

const ADB = process.env.ADB
  ?? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk', 'platform-tools', 'adb.exe');
const adb = (serial, ...args) => execFileSync(ADB, ['-s', serial, ...args], { encoding: 'utf8' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
const check = (name, ok, detail = '') => {
  // Detail on failures only. Printing the failure explanation beside a PASS
  // produced lines reading "PASS - ... (an img is present but did not decode)",
  // which is the opposite of what happened.
  console.log(`  ${ok ? 'PASS' : 'FAIL'} - ${name}${!ok && detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

async function attach(serial, port) {
  adb(serial, 'shell', 'am', 'start', '-n', `${PACKAGE}/.MainActivity`);
  await wait(2500);
  const pid = adb(serial, 'shell', 'pidof', '-s', PACKAGE).trim();
  if (!pid) throw new Error(`${PACKAGE} is not running on ${serial}`);
  adb(serial, 'forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);

  const list = await (await fetch(`http://localhost:${port}/json`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error(`no page on ${serial} — debug build?`);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let id = 0;
  const evaluate = (expression) => new Promise((resolve) => {
    const mid = ++id;
    const handler = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== mid) return;
      ws.removeEventListener('message', handler);
      resolve(message.result?.result?.value);
    };
    ws.addEventListener('message', handler);
    setTimeout(() => resolve('<timeout>'), 30000);
    ws.send(JSON.stringify({
      id: mid,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }));
  });

  const back = () => adb(serial, 'shell', 'input', 'keyevent', '4');
  return { evaluate, back };
}

/**
 * Get to a conversation, from wherever the app happens to be.
 *
 * The app may already be inside one — tapping the Chats tab does not leave a
 * conversation on a narrow layout, so a previous run left this looking for a
 * contact row that was not on screen and reporting "contact not found".
 */
async function openConversation(phone, name) {
  const inChat = async () => await phone.evaluate("Boolean(document.querySelector('input[type=file]'))");

  // Back out of whatever is open, using the real hardware button.
  for (let i = 0; i < 3 && (await inChat()); i++) {
    phone.back();
    await wait(1500);
  }

  await phone.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')]
      .find((x) => (x.innerText || '').trim().startsWith('Chats'));
    if (b) b.click();
  })()`);
  await wait(1500);

  const result = await phone.evaluate(`(async () => {
    const leaf = [...document.querySelectorAll('*')]
      .find((e) => e.children.length === 0 && (e.textContent || '').trim() === ${JSON.stringify(name)});
    if (!leaf) return 'contact not found';

    // Click the leaf. React dispatches by bubbling from the root, so the row
    // that "has" the handler has a null onclick property — walking up looking
    // for one found nothing and returned without ever clicking.
    leaf.click();
    await new Promise((r) => setTimeout(r, 1200));
    if (document.querySelector('input[type=file]')) return 'opened';

    let n = leaf.parentElement;
    for (let i = 0; i < 5 && n; i++) {
      n.click();
      await new Promise((r) => setTimeout(r, 800));
      if (document.querySelector('input[type=file]')) return 'opened via ancestor ' + (i + 1);
      n = n.parentElement;
    }
    return 'could not open';
  })()`);
  return result;
}

/** complete with a real width. A broken image is still an img element. */
const RENDER_PROBE = `JSON.stringify((() => {
  const imgs = [...document.querySelectorAll('img')].filter((i) => i.src.startsWith('blob:'));
  const good = imgs.filter((i) => i.complete && i.naturalWidth > 0);
  const text = document.body.innerText;
  return {
    imgs: imgs.length,
    rendered: good.length,
    download: /Tap to download/.test(text),
    progress: (text.match(/\\d+% ·[^\\n]*/) || [])[0] || null,
    failed: (text.match(/Not available[^\\n]*|Download failed[^\\n]*|too big[^\\n]*/) || [])[0] || null,
  };
})())`;

console.log('▸ Attaching to both phones');
const sender = await attach(SENDER, 9700);
const receiver = await attach(RECEIVER, 9701);

console.log('  sender  :', await openConversation(sender, SENDER_CONTACT));
console.log('  receiver:', await openConversation(receiver, RECEIVER_CONTACT));
await wait(2500);

// ── Send ───────────────────────────────────────────────────────────────────
console.log('\n▸ Sending a photo');
const marker = `probe-${Date.now()}`;
const sendResult = await sender.evaluate(`(async () => {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 240;
  const g = c.getContext('2d');
  g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, 320, 240);
  for (let i = 0; i < 24; i++) {
    g.fillStyle = 'hsl(' + (i * 15) + ',70%,55%)';
    g.fillRect(i * 13, (i * 7) % 200, 12, 40);
  }
  g.fillStyle = '#fff'; g.font = '16px sans-serif';
  g.fillText(${JSON.stringify(marker)}, 12, 228);

  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const file = new File([blob], ${JSON.stringify(marker + '.png')}, { type: 'image/png' });

  const input = document.querySelector('input[type=file]');
  if (!input) return 'no file input — is a conversation open?';

  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'injected ' + blob.size + ' bytes';
})()`);
console.log(' ', sendResult);

// ── The sender's own copy ──────────────────────────────────────────────────
// Polled, not checked once. A single check at 12s reported a failure that was
// really "not finished yet"; the picture appeared moments later.
console.log('\n▸ Sender');
let senderState = null;
for (let attempt = 0; attempt < 10; attempt++) {
  await wait(5000);
  senderState = JSON.parse(await sender.evaluate(RENDER_PROBE));
  console.log(`  t+${(attempt + 1) * 5}s`, JSON.stringify(senderState));
  if (senderState.rendered > 0 || senderState.failed) break;
}
check('the sender shows its own picture', (senderState?.rendered ?? 0) > 0,
  senderState?.failed
    ? senderState.failed
    : senderState?.imgs
      ? 'an img is present but did not decode — dead object URL'
      : 'no image element');

// ── The receiver ───────────────────────────────────────────────────────────
console.log('\n▸ Receiver');
let received = null;
for (let attempt = 0; attempt < 12; attempt++) {
  await wait(5000);
  received = JSON.parse(await receiver.evaluate(RENDER_PROBE));
  console.log(`  t+${(attempt + 1) * 5}s`, JSON.stringify(received));
  if (received.rendered > 0 || received.download || received.failed) break;
}
check('the attachment reached the receiver',
  Boolean(received && (received.rendered > 0 || received.download || received.progress)),
  received?.failed ?? '');

if (received && received.rendered === 0 && received.download) {
  console.log('\n  tapping to download…');
  await receiver.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')]
      .find((x) => /Tap to download/.test(x.innerText || ''));
    if (b) b.click();
  })()`);
  for (let attempt = 0; attempt < 10; attempt++) {
    await wait(5000);
    received = JSON.parse(await receiver.evaluate(RENDER_PROBE));
    console.log(`  t+${(attempt + 1) * 5}s`, JSON.stringify(received));
    if (received.rendered > 0 || received.failed) break;
  }
}
check('the receiver renders the picture', (received?.rendered ?? 0) > 0, received?.failed ?? '');

// ── Leave and come back ────────────────────────────────────────────────────
// The case that exposed the revoke bug, and the only one that did.
console.log('\n▸ Leaving the conversation and returning');
console.log('  reopened:', await openConversation(receiver, RECEIVER_CONTACT));
await wait(6000);
const afterReturn = JSON.parse(await receiver.evaluate(RENDER_PROBE));
console.log(' ', JSON.stringify(afterReturn));
check('the picture still renders after returning', afterReturn.rendered > 0,
  afterReturn.imgs
    ? 'an img is present but did not decode — the object URL died with the component'
    : afterReturn.download
      ? 'back to "Tap to download" — the fetched bytes were not reused'
      : 'no image');

console.log(`\n${'─'.repeat(64)}`);
if (failures.length) {
  console.log(`FAIL  ${failures.length} check(s) failed:`);
  for (const f of failures) console.log(`        - ${f}`);
} else {
  console.log('PASS  a photo crossed between two phones, rendered, and survived a return');
}
console.log('─'.repeat(64));
process.exit(failures.length ? 1 : 0);
