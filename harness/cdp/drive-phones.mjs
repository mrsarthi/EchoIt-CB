/**
 * S2 — the gate. One encrypted message between two physical Android phones.
 *
 * Drives both phones over `adb forward` to their webview debugging sockets,
 * reading one phone's ticket and injecting it into the other. The message
 * still crosses between two real devices over a real network; this only
 * removes the manual paste step, which has already caused one false failure.
 */

const PHONES = [
  { name: 'A', serial: process.argv[2], port: 9331 },
  { name: 'B', serial: process.argv[3], port: 9332 },
];

const ADB = 'C:/Users/wfors/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const PKG = 'io.github.mrsarthi.echoit';

const { execFile } = await import('node:child_process');
const { promisify } = await import('node:util');
const run = promisify(execFile);

const say = (m) => process.stdout.write(`${m}\n`);

async function forward(phone) {
  const { stdout } = await run(ADB, ['-s', phone.serial, 'shell', 'pidof', '-s', PKG]);
  const pid = stdout.trim();
  if (!pid) throw new Error(`${phone.name}: app not running`);
  await run(ADB, [
    '-s', phone.serial,
    'forward', `tcp:${phone.port}`, `localabstract:webview_devtools_remote_${pid}`,
  ]);
  return pid;
}

/** A CDP session against one phone's webview. */
async function session(phone) {
  const list = await (await fetch(`http://localhost:${phone.port}/json`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error(`${phone.name}: no page target`);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    const entry = pending.get(msg.id);
    if (entry) { pending.delete(msg.id); entry(msg); }
  });

  const evaluate = (expression) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, (msg) => {
        if (msg.result?.exceptionDetails) {
          reject(new Error(msg.result.exceptionDetails.exception?.description ?? 'eval failed'));
        } else resolve(msg.result?.result?.value);
      });
      ws.send(JSON.stringify({
        id: mid,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }));
    });

  return { evaluate, close: () => ws.close(), name: phone.name };
}

async function waitReady(s) {
  for (let i = 0; i < 60; i++) {
    const raw = await s.evaluate(
      'JSON.stringify({ready: !!window.__echoit?.ready, error: window.__echoit?.error ?? null, relay: !!window.__echoit?.dialableFromAnywhere})',
    );
    const { ready, error, relay } = JSON.parse(raw);
    if (error) throw new Error(`${s.name}: ${error}`);
    // Wait for a relay too: a ticket published before STUN answers carries
    // LAN addresses only, which is undialable off-network and fails looking
    // exactly like NAT traversal breaking.
    if (ready && relay) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${s.name}: never became ready with a dialable address`);
}

for (const phone of PHONES) {
  const pid = await forward(phone);
  say(`${phone.name}: ${phone.serial} pid ${pid} -> localhost:${phone.port}`);
}

const a = await session(PHONES[0]);
const b = await session(PHONES[1]);

try {
  say('\nwaiting for both harnesses...');
  await waitReady(a);
  await waitReady(b);

  const aDid = await a.evaluate('window.__echoit.did');
  const bDid = await b.evaluate('window.__echoit.did');
  say(`A did: ${aDid}`);
  say(`B did: ${bDid}`);
  if (aDid === bDid) throw new Error('both phones report the same identity');

  const aTicket = await a.evaluate('window.__echoit.ticket');
  const bTicket = await b.evaluate('window.__echoit.ticket');

  say(`\npair A: ${await a.evaluate(`window.__echoit.pair(${JSON.stringify(bTicket)})`)}`);
  say(`pair B: ${await b.evaluate(`window.__echoit.pair(${JSON.stringify(aTicket)})`)}`);

  const started = Date.now();
  say(`connect: ${await a.evaluate(`window.__echoit.connect(${JSON.stringify(bTicket)})`)}`);
  say(`connect took ${Date.now() - started}ms`);

  const a2b = `phone-A-to-B-${Date.now()}`;
  say(`send:    ${await a.evaluate(`window.__echoit.send(${JSON.stringify(a2b)})`)}`);

  const sentAt = Date.now();
  let gotA2B = false;
  for (let i = 0; i < 40; i++) {
    const got = JSON.parse(await b.evaluate('JSON.stringify(window.__echoit.received)'));
    if (got.includes(a2b)) { gotA2B = true; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  say(gotA2B ? `A -> B: DELIVERED in ${Date.now() - sentAt}ms` : 'A -> B: NOT DELIVERED');

  const b2a = `phone-B-to-A-${Date.now()}`;
  say(`send back: ${await b.evaluate(`window.__echoit.send(${JSON.stringify(b2a)})`)}`);
  let gotB2A = false;
  for (let i = 0; i < 40; i++) {
    const got = JSON.parse(await a.evaluate('JSON.stringify(window.__echoit.received)'));
    if (got.includes(b2a)) { gotB2A = true; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  say(gotB2A ? 'B -> A: DELIVERED' : 'B -> A: NOT DELIVERED');

  say(`\nA status: ${await a.evaluate('window.__echoit.status()')}`);
  say(`B status: ${await b.evaluate('window.__echoit.status()')}`);
  say(`\nA events:\n${(JSON.parse(await a.evaluate('JSON.stringify(window.__echoit.events)')) ?? []).join('\n') || '  (none)'}`);
  say(`B events:\n${(JSON.parse(await b.evaluate('JSON.stringify(window.__echoit.events)')) ?? []).join('\n') || '  (none)'}`);

  say(gotA2B && gotB2A ? '\n*** S2 PASSED — THE GATE IS OPEN ***' : '\nS2 FAILED');
} finally {
  a.close();
  b.close();
}
process.exit(0);
