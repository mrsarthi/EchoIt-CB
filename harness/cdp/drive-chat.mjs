/**
 * M2.4 driver: two app instances hold a conversation through the real UI.
 *
 * Everything here goes through the actual screens — Profile to copy a ticket,
 * Add Contact to paste one, the composer to send. No `window.__echoit`, because
 * the harness bypasses exactly the layer this is meant to prove.
 *
 * Needs two normal (non-harness) builds on 9222 and 9223.
 *
 *   node harness/cdp/drive-chat.mjs
 *
 * The claim it settles: a message typed on one device arrives on the other,
 * both ways, and survives being read back from storage.
 */

const PORTS = { a: 9222, b: 9223 };

async function session(port) {
  const list = await (await fetch(`http://localhost:${port}/json`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));

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
      setTimeout(() => resolve({ timeout: true }), 20000);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  const ev = async (expression) =>
    (await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))
      ?.result?.value;

  await call('Page.enable');
  // Reading the clipboard raises a WebView2 permission prompt that blocks the
  // page -- and the prompt itself has no buttons the driver can find, so the
  // run stalls looking like the app failed to boot. Granting up front avoids
  // it. This is the DRIVER needing clipboard read; the app only ever writes.
  await call('Browser.grantPermissions', {
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
  });
  // Clipboard reads and writes need the document focused; without this the
  // app's Copy button silently does nothing and the ticket never appears.
  const focus = () => call('Page.bringToFront');

  const clickAria = (prefix) =>
    ev(`(()=>{const e=[...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')||'').startsWith(${JSON.stringify(prefix)}));if(!e)return'missing';e.click();return'ok';})()`);
  const clickText = (t) =>
    ev(`(()=>{const e=[...document.querySelectorAll('button')].find(b=>(b.innerText||'').toLowerCase().includes(${JSON.stringify(t.toLowerCase())}));if(!e)return'missing';e.click();return'ok';})()`);
  const setField = (sel, val) =>
    ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return'missing';const P=el.tagName==='TEXTAREA'?HTMLTextAreaElement:HTMLInputElement;Object.getOwnPropertyDescriptor(P.prototype,'value').set.call(el,${JSON.stringify(val)});el.dispatchEvent(new Event('input',{bubbles:true}));return'ok';})()`);
  const text = () => ev('document.body.innerText');

  return { ev, focus, clickAria, clickText, setField, text };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m = '') => process.stdout.write(`${m}\n`);

/** Copy this instance's ticket out of its Profile tab. */
async function ticketOf(s) {
  await s.focus();
  await wait(500);
  await s.clickAria('Profile');
  await wait(1200);
  await s.clickText('Copy Connection Ticket');
  await wait(800);
  const t = await s.ev('navigator.clipboard.readText().catch(()=>"")');
  if (!t || !t.startsWith('dicsussion1')) throw new Error(`could not read a ticket (got ${t?.length ?? 0} chars)`);
  return t;
}

/** Add a contact through the Add Contact dialog. */
async function addContact(s, ticket, name) {
  await s.clickAria('Contacts');
  await wait(1000);
  await s.clickText('Add Contact');
  await wait(1000);
  await s.setField('textarea[placeholder^="Paste ticket"]', ticket);
  await s.setField('input[placeholder^="e.g. Alice"]', name);
  await wait(400);
  // Scope to the modal. A pending knock renders its own "Connect" button, and
  // it comes first in DOM order -- clicking that one reopens this dialog and
  // clears the field just filled, which looks like the paste silently failing.
  const r = await s.ev(`(()=>{
    const ta = document.querySelector('textarea[placeholder^="Paste ticket"]');
    if (!ta) return 'no modal';
    let scope = ta.parentElement;
    while (scope && ![...scope.querySelectorAll('button')].some(b=>(b.innerText||'').trim()==='Connect')) scope = scope.parentElement;
    if (!scope) return 'missing';
    const e = [...scope.querySelectorAll('button')].find(b=>(b.innerText||'').trim()==='Connect');
    if (!e) return 'missing';
    e.click();
    return 'ok';
  })()`);
  if (r !== 'ok') throw new Error('Connect button not found');
  await wait(5000);
}

/**
 * Open the conversation.
 *
 * Reading `document.body.innerText` only sees the screen that is showing, so a
 * receiver left on the Contacts tab reports every message as undelivered even
 * when it arrived. Navigate before asserting.
 */
async function openChat(s) {
  await s.clickAria('Chats');
  await wait(1200);
  await s.ev(`(()=>{const rows=[...document.querySelectorAll('div,li,button')].filter(e=>/Instance/.test(e.innerText||'')&&e.getBoundingClientRect().height<160);const r=rows[rows.length-1];if(r)(r.closest('button')||r).click();})()`);
  await wait(1500);
}

/** Open the conversation and type into the composer. */
async function sendVia(s, body) {
  await openChat(s);
  const filled = await s.setField('textarea:not([placeholder^="Paste ticket"])', body);
  if (filled !== 'ok') throw new Error('composer not found');
  await wait(400);
  const disabled = await s.ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Send message');return b?b.disabled:'missing';})()`);
  if (disabled !== false) throw new Error(`send button not enabled (${disabled})`);
  await s.ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Send message');b.click();})()`);
  await wait(3000);
}

const a = await session(PORTS.a);
const b = await session(PORTS.b);
let failed = false;

try {
  say('waiting for both apps to boot...');
  await wait(11000);

  const aTicket = await ticketOf(a);
  const bTicket = await ticketOf(b);
  say(`A ticket ${aTicket.length} chars`);
  say(`B ticket ${bTicket.length} chars`);
  if (aTicket === bTicket) throw new Error('both instances share an identity — profiles are not isolated');

  // Mutual. One-sided pairing delivers nothing, by design.
  say('\nA adds B, B adds A (through Add Contact)');
  await addContact(a, bTicket, 'Instance B');
  await addContact(b, aTicket, 'Instance A');

  // B sends first, deliberately. B added A second, so B holds the knock A left
  // when it dialled — that is B's evidence the pairing is mutual, and its
  // composer unlocks immediately. A added first and has no such evidence yet;
  // receiving this message is what settles it for A. Sending from A first
  // would fail against a correctly locked composer, not a broken one.
  const bToA = `hello-from-B-${Date.now()}`;
  say(`\nB sends: ${bToA}`);
  await sendVia(b, bToA);

  await openChat(a);
  const aSees = (await a.text()).includes(bToA);
  say(aSees ? 'B -> A: DELIVERED' : 'B -> A: NOT DELIVERED');

  const aToB = `hello-from-A-${Date.now()}`;
  say(`\nA replies: ${aToB}`);
  await sendVia(a, aToB);

  await openChat(b);
  const bSees = (await b.text()).includes(aToB);
  say(bSees ? 'A -> B: DELIVERED' : 'A -> B: NOT DELIVERED');

  // The sender must also still hold its own message: a UI that renders what
  // was typed, rather than what the SDK accepted, would pass everything above.
  const aOwn = (await a.text()).includes(aToB);
  say(`\nA still shows its own sent message: ${aOwn}`);

  say('');
  say(bSees && aSees && aOwn ? 'M2.4 PASSED — both directions, through the UI' : 'M2.4 FAILED');
  failed = !(bSees && aSees && aOwn);
} catch (error) {
  say(`\nERROR — ${error instanceof Error ? error.message : String(error)}`);
  failed = true;
}

process.exit(failed ? 1 : 0);
