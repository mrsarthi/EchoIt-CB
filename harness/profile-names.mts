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
  localNameOf,
  needsProfileSetup,
  placeholderNameFor,
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

/*
 * The reported bug, pinned.
 *
 * Every contact-creating path filled an empty nickname with the placeholder
 * *before storing it*, so "unnamed" became indistinguishable from "named
 * `Device ending in ...`" -- and the local-name rule above then did exactly
 * what it is supposed to do, forever. The result looked like a sync failure
 * and was a storage bug: whoever accepted a knock saw a real name, whoever
 * sent one never did.
 */
check('a stored placeholder is not a nickname',
  localNameOf(placeholderNameFor(DID)) === undefined);
check('so the peer’s own name comes through',
  displayNameFor(localNameOf(placeholderNameFor(DID)), profile('Sunny'), DID) === 'Sunny');
/*
 * The rows already on disk do not use `fingerprintOf`. The code that baked them
 * used `peerDid.slice(-6)` -- the DID's own mixed case -- while the placeholder
 * shown today is upper-cased. Matching only the modern spelling would leave
 * every existing contact broken, which is the only case that actually exists on
 * a phone right now.
 */
check('the legacy mixed-case placeholder is recognised too',
  localNameOf('Device ending in ...1jRYnL') === undefined);
check('a real nickname still survives the same check',
  localNameOf('Mum') === 'Mum');
check('and a blank one is not a nickname either',
  localNameOf('   ') === undefined && localNameOf(undefined) === undefined);
check('a name that merely mentions a device is left alone',
  localNameOf('Device ending in the shed') === 'Device ending in the shed');

/*
 * A knock carries a name too, and it has to be usable before any profile has
 * synced -- otherwise accepting a request shows six characters where a name
 * was on the card a second earlier.
 */
check('the knock name shows before a profile arrives',
  displayNameFor(undefined, undefined, DID, 'Sunny') === 'Sunny');
check('a synced profile is fresher than the knock',
  displayNameFor(undefined, profile('Sunny Renamed'), DID, 'Sunny') === 'Sunny Renamed');
check('but a nickname still beats both',
  displayNameFor('Mum', profile('Sunny Renamed'), DID, 'Sunny') === 'Mum');
check('a knock name is a claim, and is labelled as one',
  isClaimedName(undefined, undefined, 'Sunny'));

/*
 * Who gets asked to choose a name. Wrong in the permissive direction, everyone
 * upgrading is stopped and asked again -- so these cases are the point.
 */
check('a brand new account is asked', needsProfileSetup(undefined, undefined));
check('a published name means it was answered', !needsProfileSetup('Sarthi', ''));
check('so does a name only ever typed for knocking',
  !needsProfileSetup(undefined, 'Sarthi'));
check('blanks in both are still unanswered', needsProfileSetup('  ', '   '));

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
