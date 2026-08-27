/**
 * How many messages arrived while you were not looking.
 *
 * Pure and dependency-free so it can be tested without a device — the pattern
 * `timestamps.ts` established.
 *
 * The nav already draws a count: `SidebarNavRail` and `BottomNav` both take a
 * `badge`, and `ChatsTab` draws a per-row count. None of it has ever rendered,
 * because `unreadCount` was hardcoded `0` at two places in `AppShell`. The UI
 * was built and then never fed. This is the missing half.
 */

/** Where each conversation was last read up to, keyed by peer DID. */
export type ReadMarks = Record<string, number>;

const STORAGE_KEY = "echoit:read-marks";

/**
 * Count what has arrived since the conversation was last read.
 *
 * Only messages *from the peer* count. Your own messages are already read by
 * definition, and counting them makes the badge climb as you type — which is
 * how this is usually got wrong.
 */
export function countUnread(
  messages: ReadonlyArray<{ authorDid?: string; timestamp: number }>,
  myDid: string | null | undefined,
  readUpTo: number | undefined,
): number {
  const mark = readUpTo ?? 0;
  return messages.reduce((count, message) => {
    if (message.authorDid === myDid) return count;
    return message.timestamp > mark ? count + 1 : count;
  }, 0);
}

/**
 * Read marks survive a restart.
 *
 * Without persistence every relaunch reports every message as unread, which is
 * worse than no badge at all. Wrapped because storage throws rather than
 * returning null in private modes and with site data blocked.
 */
export function loadReadMarks(): ReadMarks {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    // Drop anything that is not a number: a corrupt entry should cost one
    // conversation's marker, not throw away every one of them.
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, value]) => typeof value === "number" && Number.isFinite(value)),
    ) as ReadMarks;
  } catch {
    return {};
  }
}

export function saveReadMarks(marks: ReadMarks): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(marks));
  } catch {
    // A failed write costs an accurate badge after restart, which is not worth
    // failing the render over.
  }
}

/** The newest thing we have heard from a peer — drives both unread and presence. */
export function lastInboundAt(
  messages: ReadonlyArray<{ authorDid?: string; timestamp: number }>,
  myDid: string | null | undefined,
): number | undefined {
  let newest: number | undefined;
  for (const message of messages) {
    if (message.authorDid === myDid) continue;
    if (newest === undefined || message.timestamp > newest) newest = message.timestamp;
  }
  return newest;
}
