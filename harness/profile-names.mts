/**
 * A peer's published name never displaces the name you gave them.
 *
 *   npx tsx harness/profile-names.mts
 *
 * Profiles introduce a second string called "name" that arrives from the
 * network and that anyone can set to anything. If it ever wins over the local
 * name, a contact can rename themselves to match another of your contacts and
 * the app has delivered the impersonation for them — which is precisely what
 * pairing exists to prevent, and which the SDK's profile service asks callers
 * not to build.
 *
 * The rule is small enough to state and easy to get backwards in a component,
 * so it is pinned here rather than left to review.
 */

import {
  displayNameFor,
  isClaimedName,
  initialsOf,
  validateDraft,
  MAX_BIO_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
} from '../src/services/profile-format.js';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const DID = 'did:key:z6MkvdyBNK2cy5oRBu4fzRzioNzJNSrcAoFzSTQ2gp1jRYnL';
const profile = (displayName?: string) => ({ displayName, updatedAt: 1 });

// The whole point.
check('the local name wins over a published one',
  displayNameFor('Mum', profile('Definitely Not Mum'), DID) === 'Mum');
check('even when the published name copies another contact',
  displayNameFor('Sunny', profile('Sunny'), DID) === 'Sunny');
check('a published name is used only when there is no local one',
  displayNameFor(undefined, profile('Sunny'), DID) === 'Sunny');
check('whitespace is not a local name',
  displayNameFor('   ', profile('Sunny'), DID) === 'Sunny');
check('with neither, the peer is identified by something proven',
  displayNameFor(undefined, undefined, DID) === 'Device ending in ...1JRYNL',
  displayNameFor(undefined, undefined, DID));
check('and an empty published name does not produce a blank row',
  displayNameFor(undefined, profile('  '), DID) === 'Device ending in ...1JRYNL');

// Screens have to label a claim as a claim, so they must be able to tell.
check('a local name is not flagged as claimed', !isClaimedName('Mum', profile('X')));
check('a published name is flagged as claimed', isClaimedName(undefined, profile('X')));
check('no name at all is not a claim', !isClaimedName(undefined, undefined));
check('an empty published name is not a claim', !isClaimedName(undefined, profile('')));

// Initials feed the placeholder avatar, which stands in for a real face.
check('one word gives one initial', initialsOf('Sunny') === 'S');
check('two words give two', initialsOf('Phone A') === 'PA');
check('extra words are ignored in the middle', initialsOf('a b c') === 'AC');
check('spacing does not produce empty initials', initialsOf('   ') === '?');

// The caps are the SDK's, checked before a round trip rather than after.
check('an over-long name is refused with its length',
  /\d+ characters/.test(validateDraft({ displayName: 'x'.repeat(MAX_DISPLAY_NAME_LENGTH + 1), bio: '' }) ?? ''));
check('a name at the cap is accepted',
  validateDraft({ displayName: 'x'.repeat(MAX_DISPLAY_NAME_LENGTH), bio: '' }) === undefined);
check('an over-long bio is refused',
  validateDraft({ displayName: '', bio: 'x'.repeat(MAX_BIO_LENGTH + 1) }) !== undefined);
check('an empty draft is fine', validateDraft({ displayName: '', bio: '' }) === undefined);

console.log(`\n${'─'.repeat(60)}`);
console.log(failures ? `FAIL  ${failures} check(s)` : 'PASS  a claimed name never displaces a local one');
console.log('─'.repeat(60));
process.exit(failures ? 1 : 0);
