/**
 * What to call a person, when two different things are both called "name".
 *
 * ## The name you publish is not the name you are shown
 *
 * Profiles introduce a second string called "name", and confusing it with the
 * first is the bug this file exists to prevent:
 *
 *  - **Their published name** is a claim. Anyone can publish anything.
 *  - **The local name** is what *you* called them when you added them, and it
 *    is the only one you have any reason to trust.
 *
 * So `displayNameFor` prefers the local name and falls back to the claim,
 * never the other way round. A peer who renames themselves to match one of
 * your other contacts must not become indistinguishable from them in your own
 * contact list — that is impersonation delivered by the app, and the SDK's own
 * profile service asks callers not to build it.
 *
 * Kept apart from `profiles.ts` because that one reaches the client and the
 * DOM, and this rule is small, load-bearing, and worth testing on its own.
 */

import { MAX_BIO_LENGTH, MAX_DISPLAY_NAME_LENGTH } from "@dicsussion/sdk";
import type { PeerProfile } from "@dicsussion/sdk";

export { MAX_BIO_LENGTH, MAX_DISPLAY_NAME_LENGTH };
export type { PeerProfile };

/** What we publish about ourselves. Empty fields are cleared, not kept. */
export interface MyProfileDraft {
  readonly displayName: string;
  readonly bio: string;
  /** `undefined` keeps the current picture; `null` removes it. */
  readonly avatar?: { readonly mime: string; readonly bytes: Uint8Array } | null;
}

/** Whether a draft is within the caps the SDK enforces. */
export function validateDraft(draft: MyProfileDraft): string | undefined {
  if (draft.displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    return `That name is ${draft.displayName.length} characters; the limit is ${MAX_DISPLAY_NAME_LENGTH}.`;
  }
  if (draft.bio.length > MAX_BIO_LENGTH) {
    return `That bio is ${draft.bio.length} characters; the limit is ${MAX_BIO_LENGTH}.`;
  }
  return undefined;
}

/**
 * What to call a peer on screen.
 *
 * The local name wins wherever there is one. See the note at the top of this
 * file for why the order is not negotiable.
 */
export function displayNameFor(
  localName: string | undefined,
  profile: PeerProfile | undefined,
  peerDid: string,
  claimedAtPairing?: string,
): string {
  const local = localName?.trim();
  if (local) return local;
  const claimed = profile?.displayName?.trim();
  if (claimed) return claimed;
  // The name they sent with their knock, before any profile has synced. Same
  // standing as a published name -- a claim -- so it sits on the same side of
  // the local name, just behind the fresher of the two.
  const knock = claimedAtPairing?.trim();
  if (knock) return knock;
  // The same six characters the request card calls a "code", in the same
  // case. Two renderings of one fingerprint is one too many when the whole
  // point is that a person can read it out and compare.
  return placeholderNameFor(peerDid);
}

/**
 * Whether to ask someone what they are called.
 *
 * Asked once, for an account that has never answered. Both stores are checked
 * because a name lives in two places for two audiences: the published profile,
 * which paired contacts read, and the knock name, which a stranger sees on a
 * request card. Either one being set means the question has been answered.
 *
 * Getting this wrong in the permissive direction is loud -- everyone upgrading
 * would be stopped and asked to name themselves again -- so it errs towards
 * not asking.
 */
export function needsProfileSetup(
  published: string | undefined,
  knockName: string | undefined,
): boolean {
  return !published?.trim() && !knockName?.trim();
}

/** What someone is called before anyone has said anything about them. */
export function placeholderNameFor(peerDid: string): string {
  return `Device ending in ...${fingerprintOf(peerDid)}`;
}

/**
 * A stored nickname, or `undefined` when there is not really one.
 *
 * ## The bug this exists for
 *
 * The nickname field is optional, and every place that created a contact
 * filled a blank one in with `Device ending in ...abc123` **before storing
 * it**. That turned "the user did not name this person" into "the user named
 * this person `Device ending in ...abc123`", which `displayNameFor` then
 * preferred over the peer's own name forever -- correctly, by its own rule,
 * since a local name is supposed to win.
 *
 * The symptom was asymmetric and looked like a sync fault: whoever accepted a
 * request saw the other person's chosen name, because the accept path stored
 * the knock's claimed name, while whoever *sent* the request kept seeing
 * `Device ending in ...` no matter what the other side published.
 *
 * Contacts are stored in `localStorage` and already carry the baked-in
 * placeholder, so recognising it is how those rows get better without a
 * migration that could lose a nickname someone actually chose. The risk is
 * someone genuinely typing a name of this exact shape; they would lose their
 * nickname and see the same six characters, which is a small and self-inflicted
 * loss next to never seeing anyone's real name.
 */
const BAKED_PLACEHOLDER = /^Device ending in \.\.\.[0-9A-Za-z]{6}$/;

export function localNameOf(stored: string | undefined): string | undefined {
  const name = stored?.trim();
  if (!name) return undefined;
  if (BAKED_PLACEHOLDER.test(name)) return undefined;
  return name;
}

/**
 * Whether what is shown came from the peer rather than from the user.
 *
 * The screens that show a claimed name have to label it as one, so they need
 * to know which of the two they ended up with.
 */
export function isClaimedName(
  localName: string | undefined,
  profile: PeerProfile | undefined,
  claimedAtPairing?: string,
): boolean {
  if (localName?.trim()) return false;
  return !!profile?.displayName?.trim() || !!claimedAtPairing?.trim();
}

/** Initials for the placeholder shown when a peer has published no picture. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * A short, stable fingerprint of a `did:key`.
 *
 * The name on a request is a claim and two people may make the same one. This
 * is the only thing on the card that is actually proven, so it is what someone
 * can read out to confirm they are accepting who they think they are.
 *
 * Six characters from the end: the prefix of a `did:key` is shared by every
 * identity of the same type and distinguishes nothing.
 */
export function fingerprintOf(peerDid: string): string {
  return peerDid.slice(-6).toUpperCase();
}
