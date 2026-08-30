/**
 * Who is allowed to reach you, and what you are called when you knock.
 *
 * ## Why a switch rather than revoking a ticket
 *
 * "Rotate the ticket" is the instinct once a ticket becomes a standing
 * invitation, and it does not work here:
 *
 *  - A ticket is your identity plus your current addresses. The identity —
 *    `did:key` and the X25519 key beneath it — comes from your seed. Changing
 *    it is not rotation, it is a new identity, and every existing contact loses
 *    you.
 *  - Addresses change on their own, but an old ticket still resolves, because
 *    discovery finds you by node id rather than by the address written down.
 *  - **The recipient cannot tell which of their tickets a knock used.** The
 *    request carries the *sender's* ticket, not the one they dialled. So there
 *    is nothing to match a knock against, and per-invite revocation is not
 *    something an application can implement on its own. It needs the request to
 *    say which invitation it is answering — recorded as an upstream request.
 *
 * What does work is refusing to listen. With `acceptRequests` off, knocks are
 * declined without being shown, which is the actual recovery for a ticket that
 * got somewhere it should not have. It is blunt, and it is honest about being
 * blunt.
 */

const NAME_KEY = "echoit.displayName";
const ACCEPT_KEY = "echoit.acceptRequests";

/**
 * Matches the SDK's cap on a request name, so a name does not have to change
 * size the moment a stranger becomes a contact.
 */
export const MAX_DISPLAY_NAME = 128;

/**
 * What you call yourself when knocking.
 *
 * Sent with a pairing request as a **claim**. The SDK's own documentation is
 * blunt about this: it carries no more authority than a name typed into a form,
 * and an app that renders it as though it were verified has undone the point of
 * pairing. Anything shown to a person must be labelled as their claim.
 */
export function loadDisplayName(): string {
  try {
    return (localStorage.getItem(NAME_KEY) ?? "").slice(0, MAX_DISPLAY_NAME);
  } catch {
    // A webview with storage disabled still works; you simply knock unnamed.
    return "";
  }
}

export function saveDisplayName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name.trim().slice(0, MAX_DISPLAY_NAME));
  } catch {
    // Not worth failing a settings screen over.
  }
}

/**
 * Whether strangers may ask to connect.
 *
 * Defaults to on — a messenger nobody can reach is not much of one — and the
 * default has to survive a storage read failing, or a wiped profile would
 * silently stop accepting anyone.
 */
export function loadAcceptRequests(): boolean {
  try {
    const raw = localStorage.getItem(ACCEPT_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

export function saveAcceptRequests(accept: boolean): void {
  try {
    localStorage.setItem(ACCEPT_KEY, String(accept));
  } catch {
    // As above.
  }
}

/**
 * Re-exported, not defined here.
 *
 * It moved to `profile-format.ts` when profiles arrived, because it is a
 * display rule and that is where the other display rules live — and because
 * `profile-format.ts` is compiled as Node code by the harness, where an import
 * pointing the other way would not resolve. Kept exported from here so the
 * screens that already ask reachability for it are not made to care.
 */
export { fingerprintOf } from "./profile-format";
