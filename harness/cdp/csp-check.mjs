/**
 * Run the app under a CSP and report every violation, plus whether the
 * harness still reaches READY.
 *
 * A CSP that blocks something the app needs usually fails silently-ish —
 * a console error and a feature that quietly does not work. Capturing the
 * violations explicitly is the difference between "it looked fine" and
 * "it is actually fine".
 */

const PORT = Number(process.argv[2] ?? 9222);

const list = await (await fetch(`http://localhost:${PORT}/json`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) { console.log('no page target'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const violations = [];
const errors = [];

ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Log.entryAdded') {
    const entry = m.params.entry;
    const text = entry.text ?? '';
    if (/content security policy|csp/i.test(text)) violations.push(text);
    else if (entry.level === 'error') errors.push(text);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    errors.push(d.exception?.description ?? d.text);
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    const t = m.params.args.map((a) => a.description ?? a.value).join(' ');
    if (/content security policy|csp/i.test(t)) violations.push(t);
    else errors.push(t);
  }
});

const send = (method, params = {}) =>
  ws.send(JSON.stringify({ id: ++id, method, params }));

send('Log.enable');
send('Runtime.enable');
send('Page.enable');
await new Promise((r) => setTimeout(r, 300));
send('Page.reload', { ignoreCache: true });

// Give the SDK time to boot, bind the endpoint, and reach a relay.
await new Promise((r) => setTimeout(r, 40000));

const after = await (await fetch(`http://localhost:${PORT}/json`)).json();
const title = after.find((t) => t.id === page.id)?.title ?? '(gone)';

const uniq = (a) => [...new Set(a)];
console.log('TITLE:', title);
console.log(`\nCSP VIOLATIONS (${uniq(violations).length}):`);
for (const v of uniq(violations)) console.log('  -', v.slice(0, 200));
console.log(`\nOTHER ERRORS (${uniq(errors).length}):`);
for (const e of uniq(errors).slice(0, 8)) console.log('  -', e.slice(0, 200));
process.exit(0);
