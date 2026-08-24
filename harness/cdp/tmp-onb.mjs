import { attach, wait } from './lib-cdp.mjs';
const s = await attach(9222);
await wait(9000);

// Call the same path the button does, and report what it actually throws.
console.log('--- direct probe of startNewIdentity path ---');
const out = await s.ev(`(async () => {
  try {
    const m = await import('/src/services/identity.ts').catch(() => null);
    return 'module-import:' + (m ? 'ok' : 'unavailable-in-bundle');
  } catch (e) { return 'ERR ' + e.message; }
})()`);
console.log(out);

console.log('\n--- screen ---');
console.log(String(await s.text()).replace(/\n{2,}/g,'\n').slice(0, 220));
console.log('\n--- console output so far ---');
console.log(s.logs.slice(-15).join('\n') || '(none)');
process.exit(0);
