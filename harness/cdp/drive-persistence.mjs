/**
 * Report what a running instance holds, so persistence can be checked across
 * a restart.
 *
 * Reported from real use: "when I open the app again, the previous msgs
 * disappear."
 *
 * `sendMessage` and `ingestRemote` write into an in-memory Automerge document.
 * `client.checkpoint()` is what puts it in IndexedDB, and the SDK only calls it
 * from `disconnect()` — which nothing invokes when a user simply closes the
 * app. Every conversation was therefore lost on the next launch.
 *
 * `drive-chat.mjs` could not have caught this: it sends and asserts inside a
 * single run. Persistence is only observable across a restart.
 *
 *   node harness/cdp/drive-persistence.mjs <port> [expected-count]
 *
 * Run it once after a conversation, restart the app with the SAME WebView2
 * profile, then run it again with the count the first run printed. It reads the
 * conversation list rather than a chat pane, so it does not depend on which
 * screen happens to be open.
 */

const PORT = Number(process.argv[2] ?? 9222);
const EXPECTED = process.argv[3] === undefined ? null : Number(process.argv[3]);
const say = (m = '') => process.stdout.write(`${m}\n`);

const list = await (await fetch(`http://localhost:${PORT}/json`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) {
  say(`no page on ${PORT} — is the app running with a debug port?`);
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.addEventListener('open', r, { once: true });
  ws.addEventListener('error', j, { once: true });
});

let id = 0;
const ev = (expression) =>
  new Promise((resolve) => {
    const mid = ++id;
    const h = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === mid) {
        ws.removeEventListener('message', h);
        resolve(m.result?.result?.value);
      }
    };
    ws.addEventListener('message', h);
    setTimeout(() => resolve('<timeout>'), 20000);
    ws.send(JSON.stringify({
      id: mid,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }));
  });

await new Promise((r) => setTimeout(r, 9000));

// Open Chats AND the conversation itself before counting.
//
// Counting whatever the screen happens to show is not a measurement: before a
// restart a chat pane is usually open, after one only the list is, so the two
// counts describe different screens rather than different storage. That
// produced a false FAIL the first time this ran. Open the conversation both
// times, and count DISTINCT message bodies.
await ev(`(()=>{
  const b=[...document.querySelectorAll('button')].find(x=>
    (x.getAttribute('aria-label')||'').startsWith('Chats') ||
    (x.innerText||'').trim().startsWith('Chats'));
  if (b) b.click();
})()`);
await new Promise((r) => setTimeout(r, 1800));

await ev(`(()=>{
  const rows=[...document.querySelectorAll('div,li,button')].filter(e=>
    /Instance|Phone/.test(e.innerText||'') && e.getBoundingClientRect().height<200);
  const r=rows[rows.length-1];
  if (r) (r.closest('button')||r).click();
})()`);
await new Promise((r) => setTimeout(r, 2500));

const body = String(await ev('document.body.innerText'));
const found = [...new Set(body.match(/hello-from-[AB]-\d+|from-[AB]-\d+/g) || [])];
const previews = found.length;
const placeholder = /No messages yet/.test(body);

say(`port ${PORT}`);
say(`  distinct messages in the conversation : ${previews}`);
say(`  "No messages yet" shown               : ${placeholder}`);
if (previews) say(`  ${found.join(', ')}`);

ws.close();

if (EXPECTED === null) {
  say('');
  say('Restart the app with the same WebView2 profile, then re-run with this');
  say(`count to assert it survived:  node harness/cdp/drive-persistence.mjs ${PORT} ${previews}`);
  process.exit(0);
}

say('');
if (previews >= EXPECTED && EXPECTED > 0) {
  say(`PASS — ${previews} of ${EXPECTED} survived the restart.`);
  process.exit(0);
}
say(`FAIL — expected ${EXPECTED}, found ${previews}. The documents were not`);
say('checkpointed, so the conversation existed only in memory.');
process.exit(1);
