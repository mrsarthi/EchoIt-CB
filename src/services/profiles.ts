/**
 * Publishing who you are.
 *
 * The half that reaches the client. Everything about *displaying* a name —
 * including the rule that a published name never displaces a local one — lives
 * in `profile-format.ts`, which has no client and no DOM in it.
 */

import type { EchoItClient } from "../transport/create-client";
import { validateDraft, type MyProfileDraft } from "./profile-format";

export * from "./profile-format";

/**
 * Publish a profile.
 *
 * An emptied field is sent as `null` rather than omitted, because omitting
 * means "keep what you had" — so clearing a bio by deleting the text and
 * saving would silently do nothing, which is the kind of bug a person reports
 * as "it didn't save".
 *
 * @returns How many connected peers received it. Zero is not a failure: the
 *   rest get it when they next connect.
 */
export async function publishProfile(
  client: EchoItClient,
  draft: MyProfileDraft,
): Promise<number> {
  const invalid = validateDraft(draft);
  if (invalid) throw new Error(invalid);

  return client.client.identity.setMyProfile({
    displayName: draft.displayName.trim() || null,
    bio: draft.bio.trim() || null,
    ...(draft.avatar === undefined ? {} : { avatar: draft.avatar }),
  });
}

