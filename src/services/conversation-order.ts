/**
 * What "most recent first" means for the chat list.
 *
 * Pure, and imported by both AppShell and its test. The previous ordering test
 * copied the comparator into itself and asserted against the copy — so it
 * passed whatever the app did, and would have kept passing if the app's sort
 * were deleted. A test of a duplicate proves the duplicate works.
 */

/** The minimum a row needs to be ordered. */
export interface OrderableConversation {
  lastActivityAt?: number;
}

/** A message, as far as ordering cares. */
interface TimedMessage {
  timestamp: number;
}

/**
 * The newest message in a conversation, or `undefined` if there is none.
 *
 * The maximum, not the last element. The thread is normally sorted ascending,
 * but live arrivals are appended in the order they turn up — a message that
 * syncs late lands at the end while being older than its neighbour.
 *
 * **The row's time, its preview and its sort position all come from this one
 * message.** They were previously computed separately: the sort key took the
 * maximum while the visible time and preview took the last element. Those agree
 * right up until they do not, and then a row shows one time while sitting in the
 * position of another — which looks exactly like the ordering being broken.
 */
export function newestOf<T extends TimedMessage>(
  thread: readonly T[] | undefined,
): T | undefined {
  if (!thread || thread.length === 0) return undefined;
  let newest = thread[0];
  for (const message of thread) {
    if (message.timestamp > newest.timestamp) newest = message;
  }
  return newest;
}

/**
 * When a conversation last had anything happen in it.
 *
 * `undefined` when nothing has, which is different from zero: a contact added
 * months ago and never written to has no claim on the top of the list.
 */
export function lastActivityOf(thread: readonly TimedMessage[] | undefined): number | undefined {
  return newestOf(thread)?.timestamp;
}

/**
 * Most recent first; never-used conversations last.
 *
 * `undefined` treated as 0 rather than compared directly, because `undefined`
 * in a numeric comparison yields NaN, and a comparator returning NaN leaves the
 * order unspecified — which looks exactly like "no sorting happened".
 */
export function byRecency(a: OrderableConversation, b: OrderableConversation): number {
  return (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0);
}

/**
 * Order a list of conversations, newest first.
 *
 * Returns a new array; the caller's list is left alone.
 */
export function orderByRecency<T extends OrderableConversation>(rows: readonly T[]): T[] {
  return [...rows].sort(byRecency);
}
