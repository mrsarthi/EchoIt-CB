/**
 * Which connection helper this device uses.
 *
 * ## Why this is a setting at all
 *
 * A relay introduces two devices and, when they cannot reach each other
 * directly, carries their traffic. It cannot read any of it — that is sealed
 * end to end — but it necessarily sees who connects and when. Since 2026-08-31
 * EchoIt ships with only our own relay rather than a third party's, which moves
 * that metadata to us instead of removing it.
 *
 * "Trust us instead" is a weaker promise than it sounds, and this setting is
 * what makes it checkable: anyone who would rather not route through our host
 * can name their own, or a public one. A default nobody can change is a claim;
 * a default anyone can replace is a choice.
 *
 * ## Why it is only validated loosely here
 *
 * Rust parses the URL properly (`RelayUrl`), refuses a bad one, and falls back
 * to ours rather than binding with no relay at all. Duplicating that parser in
 * TypeScript would mean two definitions of "valid" that could disagree, so this
 * only catches the obvious mistakes early enough to say so in the form.
 *
 * ## Changing it needs a restart
 *
 * The relay map is fixed when the endpoint binds, inside `iroh_start`. Nothing
 * here can move a running endpoint to a different relay, so the screen has to
 * say that rather than appear to apply instantly.
 */

const RELAY_KEY = "echoit.relayUrl";

/** What ships in the build. Kept in step with `ECHOIT_RELAY` in iroh_bridge.rs. */
export const DEFAULT_RELAY = "https://echoit-relay.duckdns.org";

/**
 * The relay this device should use, or `undefined` for the built-in one.
 *
 * Absent rather than the default string, so that "I never chose" and "I chose
 * the one that happens to be the default" stay distinguishable — the second
 * should survive us changing the default, and the first should not.
 */
export function loadRelayUrl(): string | undefined {
  try {
    const raw = localStorage.getItem(RELAY_KEY)?.trim();
    return raw ? raw : undefined;
  } catch {
    // A webview with storage disabled still connects, on the built-in relay.
    return undefined;
  }
}

export function saveRelayUrl(url: string | undefined): void {
  try {
    const trimmed = url?.trim();
    if (trimmed) localStorage.setItem(RELAY_KEY, trimmed);
    else localStorage.removeItem(RELAY_KEY);
  } catch {
    // Not worth failing a settings screen over.
  }
}

/**
 * Why this URL cannot be used, or `undefined` if it looks usable.
 *
 * Deliberately shallow — see the note above on not owning a second definition
 * of valid. It rejects what is certainly wrong and lets Rust judge the rest.
 */
export function describeRelayProblem(url: string): string | undefined {
  const raw = url.trim();
  if (!raw) return undefined; // empty means "use the built-in one"

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "That does not look like a web address. It should start with https://";
  }

  if (parsed.protocol !== "https:") {
    // A relay reached over plain http would let anyone on the path see which
    // devices are connecting, which is the exact thing running our own was
    // meant to narrow.
    return "A relay address must start with https:// so the connection to it is protected.";
  }
  if (!parsed.hostname || !parsed.hostname.includes(".")) {
    return "That address has no host name in it.";
  }
  return undefined;
}
