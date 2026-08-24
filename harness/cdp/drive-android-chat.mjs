/**
 * The one that matters: two physical phones hold a conversation.
 *
 * Everything goes through the real screens — onboarding, Profile to copy a
 * ticket, Add Contact to paste one, the composer to send. No `window.__echoit`:
 * the bridge harness bypasses precisely the layer this exists to prove, and on
 * a phone that layer has never run.
 *
 * Setup (the caller does this; `adb forward` is not this script's job):
 *
 *   adb -s <A> forward tcp:9300 localabstract:webview_devtools_remote_<pidA>
 *   adb -s <B> forward tcp:9301 localabstract:webview_devtools_remote_<pidB>
 *   node harness/cdp/drive-android-chat.mjs
 *
 * Needs a **debug** APK. Release builds disable webview debugging, so there is
 * no CDP endpoint to attach to — `/json` simply returns nothing.
 */

const PORTS = { a: 9300, b: 9301 };

async function session(port, label) {
  const list = await (await fetch(`http://localhost:${port}/json`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error(`${label}: no page on ${port} — is the app running?`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener('open', r, { once: true });
    ws.addEventListener('error', j, { once: true });
  });

  let id = 0;
  const call = (method, params = {}) =>
    new Promise((resolve) => {
      const mid = ++id;
      const h = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === mid) {
          ws.removeEventListener('message', h);
          resolve(m.result);
        }
      };
      ws.addEventListener('message', h);
      setTimeout(() => resolve({ timeout: true }), 25000);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  const ev = async (expression) =>
    (await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))
      ?.result?.value;

  await call('Page.enable');
  await call('Runtime.enable');

  return { label, ev, call };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m = '') => process.stdout.write(`${m}\n`);

const text = (s) => s.ev('document.body.innerText');

const clickText = (s, t) =>
  s.ev(`(()=>{const e=[...document.querySelectorAll('button')].find(b=>(b.innerText||'').toLowerCase().includes(${JSON.stringify(t.toLowerCase())}));if(!e)return'missing';e.click();return'ok';})()`);

/**
 * Click a navigation tab.
 *
 * The two navs identify their tabs differently: SidebarNavRail is icon-only
 * with aria-labels, BottomNav renders visible text and no aria-label. Android
 * is narrow, so it gets BottomNav -- matching on aria-label alone silently
 * finds nothing there.
 */
const clickAria = (s, p) =>
  s.ev(`(()=>{
    const buttons = [...document.querySelectorAll('button')];
    const byAria = buttons.find(b => (b.getAttribute('aria-label')||'').startsWith(${JSON.stringify(p)}));
    if (byAria) { byAria.click(); return 'ok'; }
    const byText = buttons.find(b => (b.innerText||'').trim().startsWith(${JSON.stringify(p)}));
    if (byText) { byText.click(); return 'ok'; }
    return 'missing';
  })()`);

/** Set a React-controlled field. Assigning `.value` alone is ignored on submit. */
const setField = (s, selector, value) =>
  s.ev(`(()=>{
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'missing';
    const P = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(P.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);

/**
 * Complete onboarding.
 *
 * Reads the recovery phrase out of the DOM and answers the confirmation from
 * it, rather than typing fixed coordinates. Driving this by taps once already
 * produced "voices say5" in a field, which looks like an app bug and is not.
 */
async function onboard(s) {
  const body = String(await text(s));
  if (!/Set up as new/.test(body)) return 'already onboarded';

  if ((await clickText(s, 'Set up as new')) !== 'ok') throw new Error(`${s.label}: no "Set up as new"`);
  await wait(3500);

  // Words render as "1." … "12." beside each word.
  const words = JSON.parse(
    String(
      await s.ev(`(()=>{
        const out = {};
        for (const el of document.querySelectorAll('*')) {
          if (el.children.length) continue;
          const m = (el.textContent || '').trim().match(/^(\\d{1,2})\\.$/);
          if (!m) continue;
          const row = el.parentElement;
          const word = (row?.textContent || '').replace(/^\\s*\\d{1,2}\\.\\s*/, '').trim();
          if (word) out[m[1]] = word;
        }
        return JSON.stringify(out);
      })()`),
    ),
  );
  if (Object.keys(words).length !== 12) {
    throw new Error(`${s.label}: read ${Object.keys(words).length} words, expected 12`);
  }

  if ((await clickText(s, "I've written it down")) !== 'ok') {
    throw new Error(`${s.label}: no "I've written it down"`);
  }
  await wait(2500);

  // Which three are asked varies per run; take it from the placeholders.
  const asked = JSON.parse(
    String(
      await s.ev(
        `JSON.stringify([...document.querySelectorAll('input')].map(i=>i.placeholder||'').filter(p=>/#\\d+/.test(p)))`,
      ),
    ),
  );
  if (asked.length !== 3) throw new Error(`${s.label}: expected 3 confirmation fields, saw ${asked.length}`);

  for (const placeholder of asked) {
    const n = placeholder.match(/#(\d+)/)[1];
    const word = words[n];
    if (!word) throw new Error(`${s.label}: asked for word #${n}, which was not read`);
    const r = await setField(s, `input[placeholder="${placeholder}"]`, word);
    if (r !== 'ok') throw new Error(`${s.label}: could not fill ${placeholder}`);
  }
  await wait(600);

  if ((await clickText(s, 'Confirm & Start Messaging')) !== 'ok') {
    throw new Error(`${s.label}: no confirm button`);
  }
  await wait(9000);
  return 'onboarded';
}

/**
 * Copy this phone's ticket out of Profile.
 *
 * Captures what the app WRITES rather than reading the clipboard back. Android
 * WebView refuses `clipboard.readText()` -- it returned 0 characters every time
 * -- and granting the permission is not reliably available on a device. The app
 * calls `navigator.clipboard.writeText` (ProfileTab), so wrapping that gets the
 * exact value a user would paste, with no permission involved.
 *
 * The wrapper still delegates to the real implementation, so the app behaves
 * normally and a failure in the actual copy would still surface.
 */
async function ticketOf(s) {
  await clickAria(s, 'Profile');
  await wait(1800);

  await s.ev(`(()=>{
    window.__ticketCapture = null;
    if (!navigator.clipboard.__wrapped) {
      const original = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = (value) => {
        window.__ticketCapture = value;
        return original(value);
      };
      navigator.clipboard.__wrapped = true;
    }
    return 'ok';
  })()`);

  if ((await clickText(s, 'Copy Connection Ticket')) !== 'ok') {
    throw new Error(`${s.label}: no "Copy Connection Ticket"`);
  }
  await wait(1500);

  const t = String((await s.ev('window.__ticketCapture')) ?? '');
  if (!t.startsWith('dicsussion1')) {
    throw new Error(`${s.label}: no ticket was copied (got ${t.length} chars)`);
  }
  return t;
}

async function addContact(s, ticket, name) {
  await clickAria(s, 'Contacts');
  await wait(1500);
  if ((await clickText(s, 'Add Contact')) !== 'ok') throw new Error(`${s.label}: no "Add Contact"`);
  await wait(1500);
  await setField(s, 'textarea[placeholder^="Paste ticket"]', ticket);
  await setField(s, 'input[placeholder^="e.g. Alice"]', name);
  await wait(500);
  // Scope to the modal: a pending knock renders its own "Connect", earlier in
  // DOM order, and clicking that reopens the dialog and clears the field.
  const r = await s.ev(`(()=>{
    const ta = document.querySelector('textarea[placeholder^="Paste ticket"]');
    if (!ta) return 'no modal';
    let scope = ta.parentElement;
    while (scope && ![...scope.querySelectorAll('button')].some(b => (b.innerText||'').trim() === 'Connect')) scope = scope.parentElement;
    if (!scope) return 'missing';
    scope.querySelectorAll('button').forEach(b => { if ((b.innerText||'').trim() === 'Connect') b.click(); });
    return 'ok';
  })()`);
  if (r !== 'ok') throw new Error(`${s.label}: Connect not found (${r})`);
  await wait(7000);
}

async function openChat(s) {
  await clickAria(s, 'Chats');
  await wait(1800);
  await s.ev(`(()=>{const rows=[...document.querySelectorAll('div,li,button')].filter(e=>/Phone [AB]/.test(e.innerText||'')&&e.getBoundingClientRect().height<200);const r=rows[rows.length-1];if(r)(r.closest('button')||r).click();})()`);
  await wait(2000);
}

async function sendVia(s, body) {
  await openChat(s);
  if ((await setField(s, 'textarea:not([placeholder^="Paste ticket"])', body)) !== 'ok') {
    throw new Error(`${s.label}: composer not found`);
  }
  await wait(600);
  const disabled = await s.ev(
    `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Send message');return b?b.disabled:'missing';})()`,
  );
  if (disabled !== false) throw new Error(`${s.label}: send button not enabled (${disabled})`);
  await s.ev(
    `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Send message');b.click();})()`,
  );
  await wait(5000);
}

const a = await session(PORTS.a, 'A');
const b = await session(PORTS.b, 'B');
let failed = false;

try {
  say('onboarding both phones...');
  say(`  A: ${await onboard(a)}`);
  say(`  B: ${await onboard(b)}`);

  const aTicket = await ticketOf(a);
  const bTicket = await ticketOf(b);
  say(`\nA ticket ${aTicket.length} chars`);
  say(`B ticket ${bTicket.length} chars`);
  if (aTicket === bTicket) throw new Error('both phones report the same ticket');

  say('\nA adds B, then B adds A (both through Add Contact)');
  await addContact(a, bTicket, 'Phone B');
  await addContact(b, aTicket, 'Phone A');

  // B added second, so B holds the knock A left when it dialled — B's evidence
  // that pairing is mutual, which unlocks its composer. A has no such evidence
  // until a message arrives, so sending from A first would fail against a
  // correctly locked composer rather than a broken one.
  const bToA = `from-B-${Date.now()}`;
  say(`\nB sends: ${bToA}`);
  await sendVia(b, bToA);

  await openChat(a);
  const aSees = String(await text(a)).includes(bToA);
  say(aSees ? 'B -> A: DELIVERED' : 'B -> A: NOT DELIVERED');

  const aToB = `from-A-${Date.now()}`;
  say(`\nA replies: ${aToB}`);
  await sendVia(a, aToB);

  await openChat(b);
  const bSees = String(await text(b)).includes(aToB);
  say(bSees ? 'A -> B: DELIVERED' : 'A -> B: NOT DELIVERED');

  const aKeeps = String(await text(a)).includes(aToB);
  say(`\nA still shows its own sent message: ${aKeeps}`);

  say('');
  const ok = aSees && bSees && aKeeps;
  say(ok ? 'TWO PHONES PASSED — a conversation, both ways, through the UI' : 'TWO PHONES FAILED');
  failed = !ok;
} catch (error) {
  say(`\nERROR — ${error instanceof Error ? error.message : String(error)}`);
  failed = true;
}

process.exit(failed ? 1 : 0);
