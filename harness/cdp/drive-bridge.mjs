/**
 * Step 1 driver: two app instances on one machine, over the Tauri bridge.
 *
 * Each instance is driven through its own remote-debugging port using
 * `Runtime.evaluate` against the `window.__echoit` harness. No UI is involved,
 * which keeps the gate intact.
 */

const PORTS = { alice: 9222, bob: 9223 };

async function target(port) {
  const list = await (await fetch(`http://localhost:${port}/json`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error(`no page on ${port}`);
  return page;
}

/** One CDP session, kept open so evaluations share the page context. */
async function session(port) {
  const page = await target(port);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    entry(msg);
  });

  const evaluate = (expression) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, (msg) => {
        const r = msg.result?.result;
        if (msg.result?.exceptionDetails) {
          reject(new Error(msg.result.exceptionDetails.exception?.description ?? 'eval failed'));
        } else resolve(r?.value);
      });
      ws.send(
        JSON.stringify({
          id: mid,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    });

  return { evaluate, close: () => ws.close() };
}

const say = (m) => process.stdout.write(`${m}\n`);

async function waitReady(s, name) {
  for (let i = 0; i < 60; i++) {
    const state = await s.evaluate(
      'JSON.stringify({ready: !!window.__echoit?.ready, error: window.__echoit?.error ?? null})',
    );
    const { ready, error } = JSON.parse(state);
    if (error) throw new Error(`${name} harness failed: ${error}`);
    if (ready) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${name} never became ready`);
}

const alice = await session(PORTS.alice);
const bob = await session(PORTS.bob);

try {
  say('waiting for both harnesses...');
  await waitReady(alice, 'alice');
  await waitReady(bob, 'bob');

  const aTicket = await alice.evaluate('window.__echoit.ticket');
  const bTicket = await bob.evaluate('window.__echoit.ticket');
  const aDid = await alice.evaluate('window.__echoit.did');
  const bDid = await bob.evaluate('window.__echoit.did');

  say(`alice ${aDid.slice(0, 28)}…`);
  say(`bob   ${bDid.slice(0, 28)}…`);

  if (aDid === bDid) {
    throw new Error('both instances share an identity — the data dirs are not isolated');
  }

  // Pairing is mutual: skipping either half means silent non-delivery.
  say(`pair alice: ${await alice.evaluate(`window.__echoit.pair(${JSON.stringify(bTicket)})`)}`);
  say(`pair bob:   ${await bob.evaluate(`window.__echoit.pair(${JSON.stringify(aTicket)})`)}`);

  say(`connect:    ${await alice.evaluate(`window.__echoit.connect(${JSON.stringify(bTicket)})`)}`);

  const a2b = `alice-to-bob-${Date.now()}`;
  say(`send:       ${await alice.evaluate(`window.__echoit.send(${JSON.stringify(a2b)})`)}`);

  let got = false;
  for (let i = 0; i < 20; i++) {
    const received = JSON.parse(await bob.evaluate('JSON.stringify(window.__echoit.received)'));
    if (received.includes(a2b)) { got = true; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  say(got ? 'ALICE -> BOB: DELIVERED' : 'ALICE -> BOB: NOT DELIVERED');

  // The reverse is a separate claim: the dialer receiving on a connection it
  // opened is not the same as the listener sending back down it.
  const b2a = `bob-to-alice-${Date.now()}`;
  say(`send back:  ${await bob.evaluate(`window.__echoit.send(${JSON.stringify(b2a)})`)}`);

  let back = false;
  for (let i = 0; i < 20; i++) {
    const received = JSON.parse(await alice.evaluate('JSON.stringify(window.__echoit.received)'));
    if (received.includes(b2a)) { back = true; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  say(back ? 'BOB -> ALICE: DELIVERED' : 'BOB -> ALICE: NOT DELIVERED');

  say(`alice status: ${await alice.evaluate('window.__echoit.status()')}`);
  say(`bob status:   ${await bob.evaluate('window.__echoit.status()')}`);
  say(got && back ? '\nSTEP 1 PASSED' : '\nSTEP 1 FAILED');
} finally {
  alice.close();
  bob.close();
}
process.exit(0);
