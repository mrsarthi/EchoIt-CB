/**
 * Does a failing onboarding tell the user anything?
 *
 * Reported from real use: entering the three confirmation words "throws me
 * back at the setup page to restart the onboarding". No error, no explanation,
 * and the recovery phrase gone.
 *
 * The cause was `startNewIdentity` setting `state = "unlocking"` before its
 * work, which unmounts `OnboardingScreen`; the failure path set
 * `state = "onboarding"`, mounting a **fresh** one at the intro step. The real
 * error — `aes-gcm: invalid tag`, an existing database under a different key —
 * was written to a component that no longer existed.
 *
 * This drives the failing path on purpose and asserts the opposite of what was
 * reported: the screen stays on the confirmation step, and says what happened.
 *
 * **Needs a machine in the failing state**: a WebView2 profile holding a
 * database encrypted under a key that is no longer in Credential Manager.
 *
 *   cmdkey /delete:LegacyGeneric:target=storage-key.io.github.mrsarthi.echoit
 *   node harness/cdp/drive-onboarding-failure.mjs [port]
 *
 * The happy path is covered by `drive-chat.mjs`, which only ever succeeds —
 * which is exactly why this failure went unnoticed.
 */

import { attach, wait } from './lib-cdp.mjs';

const port = Number(process.argv[2] ?? 9222);
const say = (m = '') => process.stdout.write(`${m}\n`);

const s = await attach(port);
await wait(9000);

const clickText = (t) =>
  s.ev(`(()=>{const e=[...document.querySelectorAll('button')].find(b=>(b.innerText||'').toLowerCase().includes(${JSON.stringify(t.toLowerCase())}));if(!e)return'missing';e.click();return'ok';})()`);

const setField = (sel, val) =>
  s.ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return'missing';
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(val)});
    el.dispatchEvent(new Event('input',{bubbles:true}));return'ok';})()`);

let failed = false;

try {
  const start = String(await s.ev('document.body.innerText'));
  if (!/Set up as new/.test(start)) {
    say('Not on the intro screen. The app is in this state instead:');
    say(start.replace(/\n{2,}/g, '\n').slice(0, 240));
    say('');
    say('Delete the credential and relaunch so onboarding is reachable:');
    say('  cmdkey /delete:LegacyGeneric:target=storage-key.io.github.mrsarthi.echoit');
    process.exit(1);
  }

  say(`set up as new: ${await clickText('Set up as new')}`);
  await wait(3000);

  const words = JSON.parse(
    String(
      await s.ev(`(()=>{const out={};
        for (const el of document.querySelectorAll('*')) {
          if (el.children.length) continue;
          const m = (el.textContent||'').trim().match(/^(\\d{1,2})\\.$/);
          if (!m) continue;
          const word = (el.parentElement?.textContent||'').replace(/^\\s*\\d{1,2}\\.\\s*/,'').trim();
          if (word) out[m[1]] = word;
        }
        return JSON.stringify(out);})()`),
    ),
  );
  say(`read ${Object.keys(words).length} words from the phrase`);

  say(`written it down: ${await clickText("I've written it down")}`);
  await wait(2000);

  const asked = JSON.parse(
    String(
      await s.ev(
        `JSON.stringify([...document.querySelectorAll('input')].map(i=>i.placeholder||'').filter(p=>/#\\d+/.test(p)))`,
      ),
    ),
  );
  for (const placeholder of asked) {
    const n = placeholder.match(/#(\d+)/)[1];
    await setField(`input[placeholder="${placeholder}"]`, words[n]);
  }
  say(`filled ${asked.length} confirmation words: ${asked.join(', ')}`);

  say(`confirm: ${await clickText('Confirm & Start Messaging')}`);
  await wait(9000);

  const after = String(await s.ev('document.body.innerText'));
  const bouncedToIntro = /Set up as new/.test(after);
  const stillConfirming = /Confirm Your Phrase/.test(after);
  const showsError = /Setup failed|Could not initialize|invalid tag|error/i.test(after);

  say('');
  say(`bounced back to the intro : ${bouncedToIntro}`);
  say(`still on the confirm step : ${stillConfirming}`);
  say(`an error is displayed     : ${showsError}`);
  say('');
  say('--- what the user sees ---');
  say(after.replace(/\n{2,}/g, '\n').slice(0, 400));
  say('');

  if (bouncedToIntro && !showsError) {
    say('FAIL — silently restarted the flow. This is the reported bug.');
    failed = true;
  } else if (showsError) {
    say('PASS — the failure is explained rather than swallowed.');
  } else {
    say('INCONCLUSIVE — did not bounce, but no error surfaced either.');
    say('Onboarding may simply have succeeded; this needs a failing machine.');
    failed = true;
  }
} catch (error) {
  say(`\nERROR — ${error instanceof Error ? error.message : String(error)}`);
  failed = true;
}

process.exit(failed ? 1 : 0);
