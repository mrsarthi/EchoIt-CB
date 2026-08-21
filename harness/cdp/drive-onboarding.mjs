/**
 * Drive the onboarding flow the way a user would, then reload.
 *
 * Two questions this answers that reading the code cannot:
 *   1. Does the flow actually complete — phrase → verify → a live client?
 *   2. On the second launch, does the stored key unlock cleanly, or does
 *      StrictMode's double-invoked effect build two clients over one database?
 */

const PORT = Number(process.argv[2] ?? 9224);

const list = await (await fetch(`http://localhost:${PORT}/json`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) { console.log('no page target'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const consoleLines = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleLines.push(m.params.args.map((a) => a.description ?? a.value).join(' '));
  }
});

const ev = (expr) => new Promise((res, rej) => {
  const mid = ++id;
  const h = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== mid) return;
    ws.removeEventListener('message', h);
    if (m.result?.exceptionDetails) rej(new Error(m.result.exceptionDetails.exception?.description ?? 'eval failed'));
    else res(m.result?.result?.value);
  };
  ws.addEventListener('message', h);
  ws.send(JSON.stringify({
    id: mid, method: 'Runtime.evaluate',
    params: { expression: expr, awaitPromise: true, returnByValue: true },
  }));
});

ws.send(JSON.stringify({ id: ++id, method: 'Runtime.enable' }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// React ignores programmatic `.value =`, so set through the native setter and
// dispatch the event React is actually listening for.
const setInput = (elementId, value) => ev(`(() => {
  const el = document.getElementById(${JSON.stringify(elementId)});
  if (!el) return 'missing';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);

const clickByText = (text) => ev(`(() => {
  const el = [...document.querySelectorAll('button')]
    .find(b => b.innerText.trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));
  if (!el) return 'missing';
  el.click();
  return 'ok';
})()`);

await ev('window.location.reload()').catch(() => {});
await wait(6000);
console.log('step 1 — start setup:', await clickByText('Set up as new'));
await wait(1200);

const words = JSON.parse(await ev(`JSON.stringify(
  [...document.querySelectorAll('div')]
    .filter(d => /^\\d+\\.$/.test(d.children[0]?.innerText?.trim() ?? ''))
    .map(d => d.children[1].innerText.trim())
)`));
console.log(`step 2 — phrase shown: ${words.length} words`);
if (words.length !== 12) { console.log('EXPECTED 12 WORDS, got', words); process.exit(1); }

console.log('step 3 — proceed to verify:', await clickByText("I've written it down"));
await wait(1000);

// Which words are being asked for is decided by the app; read the labels.
const asked = JSON.parse(await ev(`JSON.stringify(
  [...document.querySelectorAll('input')].map(i => i.id)
)`));
console.log('step 4 — verification asks for:', asked.join(', '));

for (const inputId of asked) {
  const idx = Number(inputId.split('-').pop());
  const answer = words[idx];
  const r = await setInput(inputId, answer);
  console.log(`   word ${idx + 1} = ${answer}: ${r}`);
}
await wait(400);

console.log('step 5 — submit:', await clickByText('Confirm'));
await wait(20000);

const text = (await ev('document.body.innerText')) ?? '';
console.log('\n--- after onboarding ---');
console.log(text.slice(0, 400));

console.log('\n--- console output during onboarding ---');
console.log(consoleLines.slice(0, 15).join('\n') || '(none)');

// Second launch: the stored key should unlock without drama.
console.log('\n=== reloading (second launch, stored key present) ===');
consoleLines.length = 0;
await ev('window.location.reload()').catch(() => {});
await wait(25000);

const text2 = (await ev('document.body.innerText').catch(() => '')) ?? '';
console.log(text2.slice(0, 400));
console.log('\n--- console on second launch ---');
console.log(consoleLines.slice(0, 20).join('\n') || '(none)');
process.exit(0);
