/**
 * Onboarding on Android, including the path where it fails.
 *
 * Two bugs were found on desktop by a human trying to onboard, and both lived
 * in `AppContext` — shared code, so Android had them too:
 *
 *   1. A failure unmounted `OnboardingScreen` and remounted it at the intro,
 *      losing the recovery phrase and showing nothing.
 *   2. The storage key was written before the client was built, so a failure
 *      left a key with no identity behind it. The next launch then skips
 *      onboarding and creates an identity whose phrase was never shown.
 *
 * The fix for (2) calls `clearStorageKey` → `keychain_delete` →
 * `android-native-keyring-store`. **That delete has never run on Android.** If
 * it is a no-op there, the code looks fixed and the bug survives — the same
 * shape as the `ndk_context` crash, which also compiled fine and had simply
 * never executed.
 *
 * So this manufactures the failure rather than assuming it:
 *
 *   1. Onboard for real.
 *   2. Delete the key through the app's own command, and restart.
 *      Onboarding reappearing is what proves the delete works.
 *   3. Onboard again against the now-undecryptable database, and check the
 *      screen explains itself and leaves no key behind.
 *
 *   node harness/cdp/drive-android-onboarding.mjs <serial>
 *
 * Needs a debug APK; release builds disable webview debugging.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ADB = 'C:/Users/wfors/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const PKG = 'io.github.mrsarthi.echoit';
const SERIAL = process.argv[2];
const PORT = 9350;

if (!SERIAL) {
  console.error('usage: node harness/cdp/drive-android-onboarding.mjs <serial>');
  process.exit(1);
}

const say = (m = '') => process.stdout.write(`${m}\n`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = async (...args) => (await run(ADB, ['-s', SERIAL, ...args])).stdout.trim();

async function restart() {
  await adb('shell', 'am', 'force-stop', PKG);
  await wait(1500);
  await adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
  await wait(12000);
}

/** Attach to the app's webview. The pid changes on every restart. */
async function attach() {
  const pid = await adb('shell', 'pidof', '-s', PKG);
  if (!pid) throw new Error('app is not running');
  await adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`);

  const list = await (await fetch(`http://localhost:${PORT}/json`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page — is this a debug build?');
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
      setTimeout(() => resolve('<timeout>'), 25000);
      ws.send(JSON.stringify({
        id: mid,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }));
    });

  return { ev, close: () => ws.close() };
}

const text = (s) => s.ev('document.body.innerText');
const clickText = (s, t) =>
  s.ev(`(()=>{const e=[...document.querySelectorAll('button')].find(b=>(b.innerText||'').toLowerCase().includes(${JSON.stringify(t.toLowerCase())}));if(!e)return'missing';e.click();return'ok';})()`);
const setField = (s, sel, val) =>
  s.ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return'missing';
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(val)});
    el.dispatchEvent(new Event('input',{bubbles:true}));return'ok';})()`);

/** Walk onboarding, answering the confirmation from the phrase on screen. */
async function onboard(s) {
  if (!/Set up as new/.test(String(await text(s)))) return 'not-on-intro';

  await clickText(s, 'Set up as new');
  await wait(3500);

  const words = JSON.parse(String(await s.ev(`(()=>{const out={};
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length) continue;
      const m = (el.textContent||'').trim().match(/^(\\d{1,2})\\.$/);
      if (!m) continue;
      const word = (el.parentElement?.textContent||'').replace(/^\\s*\\d{1,2}\\.\\s*/,'').trim();
      if (word) out[m[1]] = word;
    }
    return JSON.stringify(out);})()`)));
  if (Object.keys(words).length !== 12) throw new Error(`read ${Object.keys(words).length} words`);

  await clickText(s, "I've written it down");
  await wait(2500);

  const asked = JSON.parse(String(await s.ev(
    `JSON.stringify([...document.querySelectorAll('input')].map(i=>i.placeholder||'').filter(p=>/#\\d+/.test(p)))`,
  )));
  for (const placeholder of asked) {
    await setField(s, `input[placeholder="${placeholder}"]`, words[placeholder.match(/#(\d+)/)[1]]);
  }
  await wait(600);
  await clickText(s, 'Confirm & Start Messaging');
  await wait(10000);
  return 'done';
}

let failed = false;

try {
  // ── 1. A real onboarding, so there is a key and a database to break ──────
  say('1. onboarding for real');
  await restart();
  let s = await attach();
  const first = await onboard(s);
  const afterFirst = String(await text(s));
  const onboarded = /No conversations yet|Chats/.test(afterFirst) && !/Set up as new/.test(afterFirst);
  say(`   ${first} → onboarded: ${onboarded}`);
  if (!onboarded) throw new Error('first onboarding did not complete; nothing to test against');

  // ── 2. Delete the key through the app's own command ──────────────────────
  say('\n2. deleting the storage key via keychain_delete');
  const del = String(await s.ev(
    `window.__TAURI_INTERNALS__.invoke('keychain_delete',{account:'storage-key'}).then(()=>'ok').catch(e=>'THREW '+e)`,
  ));
  say(`   keychain_delete → ${del}`);
  s.close();

  await restart();
  s = await attach();
  const afterDelete = String(await text(s));
  const deleteWorks = /Set up as new/.test(afterDelete);
  say(`   onboarding reappeared after restart: ${deleteWorks}`);
  if (!deleteWorks) {
    say('   FAIL — the key survived. keychain_delete is a no-op on Android,');
    say('   so a failed onboarding still leaves a key behind and the next');
    say('   launch creates an identity whose phrase was never shown.');
    failed = true;
  }

  // ── 3. Onboard again, against a database the new key cannot open ─────────
  if (deleteWorks) {
    say('\n3. onboarding again — the database cannot be decrypted now');
    await onboard(s);
    const after = String(await text(s));
    const bounced = /Set up as new/.test(after);
    const stillConfirming = /Confirm Your Phrase/.test(after);
    const showsError = /Could not initialize|Setup failed|invalid tag/i.test(after);

    say(`   bounced to intro    : ${bounced}`);
    say(`   still on confirm    : ${stillConfirming}`);
    say(`   error displayed     : ${showsError}`);
    say('');
    say('   --- what the user sees ---');
    say(after.replace(/\n{2,}/g, '\n').split('\n').slice(0, 12).map((l) => `   ${l}`).join('\n'));

    if (bounced && !showsError) {
      say('\n   FAIL — silently restarted. Bug 1 is live on Android.');
      failed = true;
    } else if (!showsError) {
      say('\n   INCONCLUSIVE — no error surfaced; it may have succeeded.');
      failed = true;
    }

    // Bug 2: after that failure, is a key left behind?
    s.close();
    await restart();
    s = await attach();
    const leftBehind = !/Set up as new/.test(String(await text(s)));
    say(`\n   key left behind after the failure: ${leftBehind}`);
    if (leftBehind) {
      say('   FAIL — bug 2 is live on Android: the next launch skips');
      say('   onboarding and makes an identity with no phrase shown.');
      failed = true;
    }
  }

  s.close();
  say('');
  say(failed ? 'ANDROID ONBOARDING: FAILED' : 'ANDROID ONBOARDING: PASSED — fails safely and leaves no key');
} catch (error) {
  say(`\nERROR — ${error instanceof Error ? error.message : String(error)}`);
  failed = true;
}

process.exit(failed ? 1 : 0);
