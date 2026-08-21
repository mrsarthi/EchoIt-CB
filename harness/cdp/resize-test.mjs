/**
 * The headline requirement: one window, dragged across 840px, must move between
 * two-pane and bottom tabs with no dead state in between.
 *
 * Resizes the real OS window rather than emulating a viewport, so this also
 * proves WebView2 propagates the resize into matchMedia.
 */
const { execFile } = await import('node:child_process');
const { promisify } = await import('node:util');
const run = promisify(execFile);

const l = await (await fetch('http://localhost:9222/json')).json();
const page = l.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const ev = (x) => new Promise((res) => {
  const mid = ++id;
  const h = (e) => { const m = JSON.parse(e.data); if (m.id === mid) { ws.removeEventListener('message', h); res(m.result?.result?.value); } };
  ws.addEventListener('message', h);
  setTimeout(() => res('<timeout>'), 10000);
  ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression: x, awaitPromise: true, returnByValue: true } }));
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function setWidth(w, h = 760) {
  const ps = `
$sig = '[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int cx,int cy,uint f);'
$t = Add-Type -MemberDefinition $sig -Name W -Namespace Q -PassThru
$p = Get-Process echoit -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($p) { $t::SetWindowPos($p.MainWindowHandle,[IntPtr]::Zero,100,100,${w},${h},0x4) | Out-Null; 'ok' } else { 'no window' }`;
  const { stdout } = await run('powershell', ['-NoProfile', '-Command', ps]);
  return stdout.trim();
}

// What is on screen, in terms a human would recognise.
const probe = () => ev(`(() => {
  const bottom = document.querySelector('[aria-label="Bottom Navigation"]');
  const rail   = document.querySelector('[aria-label="Desktop Navigation Rail"]');
  const vis = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none';
  };
  return JSON.stringify({
    w: window.innerWidth,
    bottomTabs: vis(bottom),
    sidebarRail: vis(rail),
    both: vis(bottom) && vis(rail),
    neither: !vis(bottom) && !vis(rail),
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
  });
})()`);

for (const w of [1200, 900, 860, 840, 830, 700, 500, 1200]) {
  const r = await setWidth(w);
  if (r !== 'ok') { console.log('resize failed:', r); break; }
  await wait(900);
  console.log(String(w).padStart(4), '->', await probe());
}
process.exit(0);
