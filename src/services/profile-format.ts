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
): string {
  const local = localName?.trim();
  if (local) return local;
  const claimed = profile?.displayName?.trim();
  if (claimed) return claimed;
  // The same six characters the request card calls a "code", in the same
  // case. Two renderings of one fingerprint is one too many when the whole
  // point is that a person can read it out and compare.
  return `Device ending in ...${fingerprintOf(peerDid)}`;
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
): boolean {
  return !localName?.trim() && !!profile?.displayName?.trim();
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
