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
 * How many conversations are waiting, for a nav badge.
 *
 * Conversations, not messages. Twelve unread messages from one person is one
 * thing to go and look at, and a badge reading "12" that resolves to a single
 * row teaches people that badges overstate. The per-row count in the list is
 * where a message total belongs.
 *
 * Whatever is open does not count. A conversation being read is not something
 * you have yet to look at, and its read mark does not necessarily advance
 * while you sit in it — so counting it would leave a badge on the way *out* of
 * the conversation you just read.
 */
export function countWaitingConversations(
  conversations: ReadonlyArray<{ id: string; unreadCount?: number }>,
  openId: string | null | undefined,
): number {
  return conversations.reduce(
    (total, conversation) =>
      (conversation.unreadCount ?? 0) > 0 && conversation.id !== openId
        ? total + 1
        : total,
    0,
  );
}

/**
 * How many of the newly-arrived messages came from the other person.
 *
 * Feeds the "N new messages" pill inside a conversation, which only appears
 * while the reader is scrolled away from the end.
 *
 * Your own messages never count. Sending one from this screen is not something
 * you need telling about, and counting it raises a pill announcing your own
 * words — which is both useless and the obvious way to get this wrong, since
 * the list grows identically either way.
 *
 * @param messages The thread as it is now.
 * @param previousLength How long it was when this was last checked.
 */
export function countIncomingSince(
  messages: ReadonlyArray<{ isOutgoing?: boolean }>,
  previousLength: number,
): number {
  const arrived = messages.length - previousLength;
  // Negative when messages were removed — hidden, or a conversation switched
  // under it. Nothing arrived, so nothing is announced.
  if (arrived <= 0) return 0;
  return messages.slice(-arrived).reduce(
    (total, message) => (message.isOutgoing ? total : total + 1),
    0,
  );
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
