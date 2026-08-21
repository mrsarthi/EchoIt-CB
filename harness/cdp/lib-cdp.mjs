export async function attach(port) {
  const l = await (await fetch(`http://localhost:${port}/json`)).json();
  const page = l.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const logs = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(m.params.args.map((a) => a.description ?? a.value).join(' '));
    }
  });
  const ev = (x) => new Promise((res) => {
    const mid = ++id;
    const h = (e) => { const m = JSON.parse(e.data); if (m.id === mid) { ws.removeEventListener('message', h); res(m.result?.result?.value); } };
    ws.addEventListener('message', h);
    setTimeout(() => res('<timeout>'), 15000);
    ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression: x, awaitPromise: true, returnByValue: true } }));
  });
  ws.send(JSON.stringify({ id: ++id, method: 'Runtime.enable' }));
  const click = (text) => ev(`(()=>{const el=[...document.querySelectorAll('button,[role="tab"],[role="option"]')].find(b=>(b.innerText||'').trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));if(!el)return 'missing';el.click();return 'ok';})()`);
  const text = () => ev('document.body.innerText');
  return { ev, click, text, logs, port };
}
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
