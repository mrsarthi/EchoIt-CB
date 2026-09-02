/**
 * Links are found where they are meant, and nowhere else.
 *
 *   npx tsx harness/link-segments.mts
 *
 * A wrong link is worse than a missed one: it invites a tap on something the
 * writer never intended to be tappable. So the false positives matter at least
 * as much as the matches, and both are pinned here.
 */

import { segmentText, hasLink, hostOf, describeOpen } from '../src/services/links.js';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const links = (t: string) => segmentText(t).filter((s) => s.kind === 'link');
const text = (t: string) => segmentText(t).filter((s) => s.kind === 'text').map((s) => s.value).join('');

check('a plain url is found', links('see https://example.com now')[0]?.value === 'https://example.com');
check('and the words around it survive', text('see https://example.com now') === 'see  now');
check('www without a scheme is found', links('try www.example.com')[0]?.value === 'www.example.com');
check('and is given one to open with',
  links('try www.example.com')[0]?.href === 'https://www.example.com');

check('a full stop ends the sentence, not the url',
  links('go to https://example.com.')[0]?.value === 'https://example.com',
  links('go to https://example.com.')[0]?.value);
check('so does a closing bracket',
  links('(https://example.com/a)')[0]?.value === 'https://example.com/a');

check('two links are both found', links('https://a.com and https://b.com').length === 2);

// The false positives. Each of these turned prose into a link in some other app.
check('a sentence with a dot is not a link', links('see figure 1.a for detail').length === 0);
check('a file name is not a link', links('opened report.pdf yesterday').length === 0);
check('a bare domain is not a link', links('go to example.com').length === 0,
  'deliberate: a scheme or www. is the signal that someone meant a link');
check('an empty message produces one empty run', segmentText('').length === 1);
check('a message with no link is one run', segmentText('hello there').length === 1);
check('hasLink agrees', hasLink('a https://x.com b') && !hasLink('no link here'));

check('the host is what gets named', hostOf('https://example.com/very/long/path') === 'example.com');
check('an unreadable url has no host', hostOf('not a url') === undefined);

// The dialog has to name where you are going and not promise it is safe.
const warning = describeOpen('https://example.com/x');
check('the confirmation names the host', warning.includes('example.com'));
check('and never claims the site is safe', !/\bsafe\b/i.test(warning.replace('Only open links from people you trust.', '')));
check('and says what following it costs', /IP address/.test(warning));

console.log(`\n${'─'.repeat(60)}`);
console.log(failures ? `FAIL  ${failures} check(s)` : 'PASS  links are found where meant, and nowhere else');
console.log('─'.repeat(60));
process.exit(failures ? 1 : 0);
