/**
 * Background delivery — what Q8 actually needs to know.
 *
 * "Does a backgrounded phone receive messages?" is the obvious question and
 * the answer is almost certainly no; Android suspends the app. The question
 * that decides the architecture is what happens to the message:
 *
 *   queued → it arrives when the app returns. A UX problem.
 *   lost   → the sender believed it delivered and it evaporated. A
 *            correctness problem, and push or a foreground service becomes
 *            mandatory before beta.
 *
 * Sends at three depths, because Android's suspension is staged rather than
 * immediate: freshly backgrounded, after 30s, and after 90s (approaching
 * Doze).
 */

const ADB = 'C:/Users/wfors/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const PKG = 'io.github.mrsarthi.echoit';

const A = { name: 'A', serial: process.argv[2], port: 9341 };
const B = { name: 'B', serial: process.argv[3], port: 9342 };

const { execFile } = await import('node:child_process');
const { promisify } = await import('node:util');
const run = promisify(execFile);
const say = (m) => process.stdout.write(`${m}\n`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function adb(phone, ...args) {
  const { stdout } = await run(ADB, ['-s', phone.serial, ...args]);
  return stdout.trim();
}

async function attach(phone) {
  const pid = await adb(phone, 'shell', 'pidof', '-s', PKG);
  if (!pid) throw new Error(`${phone.name}: app not running`);
  await adb(phone, 'forward', `tcp:${phone.port}`, `localabstract:webview_devtools_remote_${pid}`);

  const list = await (await fetch(`http://localhost:${phone.port}/json`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    const entry = pending.get(m.id);
    if (entry) { pending.delete(m.id); entry(m); }
  });

  const evaluate = (expression) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, (m) => {
        // A suspended webview stops answering. That is a result, not an
        // error: it tells us Android froze JS execution while backgrounded.
        if (m.result?.exceptionDetails) resolve('<<eval-failed>>');
        else resolve(m.result?.result?.value);
      });
      // Same for a total lack of reply.
      setTimeout(() => {
        if (pending.delete(mid)) resolve('<<no-response>>');
      }, 8000);
      ws.send(JSON.stringify({
        id: mid, method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }));
    });

  return { ...phone, evaluate, close: () => ws.close(), pid };
}

async function ready(s) {
  for (let i = 0; i < 60; i++) {
    const raw = await s.evaluate(
      'JSON.stringify({r: !!window.__echoit?.ready, relay: !!window.__echoit?.dialableFromAnywhere})',
    );
    const { r, relay } = JSON.parse(raw);
    if (r && relay) return;
    await wait(2000);
  }
  throw new Error(`${s.name}: not ready`);
}

const received = async (s) => {
  const raw = await s.evaluate('JSON.stringify(window.__echoit.received)');
  if (typeof raw !== 'string' || raw.startsWith('<<')) return null; // frozen
  try { return JSON.parse(raw); } catch { return null; }
};

const a = await attach(A);
const b = await attach(B);

try {
  await ready(a);
  await ready(b);

  // Pair and connect fresh.
  const at = await a.evaluate('window.__echoit.ticket');
  const bt = await b.evaluate('window.__echoit.ticket');
  await a.evaluate(`window.__echoit.pair(${JSON.stringify(bt)})`);
  await b.evaluate(`window.__echoit.pair(${JSON.stringify(at)})`);
  await a.evaluate(`window.__echoit.connect(${JSON.stringify(bt)})`);

  // Baseline: prove delivery works before backgrounding anything, so a
  // later failure cannot be blamed on the connection never having worked.
  const warmup = `warmup-${Date.now()}`;
  await a.evaluate(`window.__echoit.send(${JSON.stringify(warmup)})`);
  let warm = false;
  for (let i = 0; i < 20 && !warm; i++) {
    warm = ((await received(b)) ?? []).includes(warmup);
    if (!warm) await wait(500);
  }
  say(`baseline (both foreground): ${warm ? 'DELIVERED' : 'FAILED — aborting'}`);
  if (!warm) process.exit(1);

  say(`\nB status before backgrounding: ${await b.evaluate('window.__echoit.status()')}`);

  // Background B with the HOME key — what a user actually does.
  await adb(B, 'shell', 'input', 'keyevent', 'KEYCODE_HOME');
  say('\nB sent to background (HOME)\n');

  const probes = [
    { label: 'immediately after backgrounding', delay: 2000 },
    { label: 'after 30s backgrounded', delay: 30000 },
    { label: 'after 90s backgrounded (approaching Doze)', delay: 60000 },
  ];

  const sent = [];
  for (const probe of probes) {
    await wait(probe.delay);
    const msg = `bg-${probe.label.replace(/\W+/g, '-')}-${Date.now()}`;
    const result = await a.evaluate(`window.__echoit.send(${JSON.stringify(msg)})`);
    const alive = (await adb(B, 'shell', 'pidof', '-s', PKG)) !== '';
    say(`sent ${probe.label}`);
    say(`   A: ${result} | A status: ${await a.evaluate('window.__echoit.status()')}`);
    say(`   B process alive: ${alive}`);
    sent.push(msg);
  }

  // Did anything arrive while B was backgrounded? The CDP session survives
  // backgrounding as long as the process does.
  const whileBackgrounded = await received(b);
  const arrivedInBackground = whileBackgrounded
    ? sent.filter((m) => whileBackgrounded.includes(m))
    : [];
  say(
    whileBackgrounded
      ? `\ndelivered WHILE backgrounded: ${arrivedInBackground.length}/${sent.length}`
      : '\nB webview was frozen — could not be queried while backgrounded',
  );

  // Foreground B and see whether the rest arrive — the queued-vs-lost answer.
  await adb(B, 'shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
  say('\nB brought to foreground; waiting 30s for any queued delivery...');
  await wait(30000);

  const afterForeground = (await received(b)) ?? [];
  const arrivedAfter = sent.filter((m) => afterForeground.includes(m));

  say(`\ndelivered AFTER foregrounding: ${arrivedAfter.length}/${sent.length}`);
  say(`A status: ${await a.evaluate('window.__echoit.status()')}`);
  say(`B status: ${await b.evaluate('window.__echoit.status()')}`);
  const rawEvents = await b.evaluate('JSON.stringify(window.__echoit.events)');
  const bEvents =
    typeof rawEvents === 'string' && !rawEvents.startsWith('<<')
      ? (JSON.parse(rawEvents) ?? [])
      : [];
  say(`\nB events:\n${bEvents.join('\n') || '  (none)'}`);

  say('\n--- VERDICT ---');
  if (arrivedInBackground.length === sent.length) {
    say('Messages arrive while backgrounded. Background delivery works unaided.');
  } else if (arrivedAfter.length === sent.length) {
    say('QUEUED: nothing arrived while backgrounded, everything arrived on return.');
    say('Q8 is a UX problem, not data loss.');
  } else {
    say(`LOST: ${sent.length - arrivedAfter.length} of ${sent.length} never arrived.`);
    say('The sender reported success for messages that evaporated.');
    say('Push or a foreground service becomes mandatory before beta.');
  }
} finally {
  a.close();
  b.close();
}
process.exit(0);
