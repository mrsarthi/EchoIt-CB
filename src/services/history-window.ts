/**
 * How much of a conversation is on screen at once.
 *
 * ## What this is actually saving
 *
 * Not network time. History lives in a local CRDT document, so reading further
 * back is a local read and returns in milliseconds — there is no server to wait
 * for, and a spinner pretending otherwise would be theatre.
 *
 * What it saves is *rendering*. Every message is a DOM node, and a picture is a
 * decoded bitmap held in memory. A conversation with a few thousand messages
 * built all at once is a slow open and a large footprint on a phone, for
 * content nobody is looking at.
 *
 * So the window starts small, grows when the reader reaches the top, and the
 * "loading" state exists to keep the list from jumping rather than to fill a
 * wait.
 *
 * ## Why the SDK shapes it this way
 *
 * `getHistory(channelId, limit)` caps to the **most recent** `limit` messages.
 * There is no cursor and no offset, so paging backwards means asking for a
 * larger window and taking the extra from the front — not fetching a distinct
 * page. That is why this counts a size rather than tracking an offset.
 */

/**
 * How many messages a conversation opens with.
 *
 * Enough to fill any phone screen several times over, so the common case never
 * touches the growth path at all.
 */
export const INITIAL_WINDOW = 60;

/** How many more to reveal each time the reader reaches the top. */
export const WINDOW_STEP = 60;

/**
 * How close to the top counts as asking for more.
 *
 * Generous, because the point is to have the messages already in place by the
 * time the reader gets there rather than to react once they arrive.
 */
export const LOAD_MORE_THRESHOLD_PX = 240;

export interface HistoryWindow {
  /** How many of the newest messages to show. */
  size: number;
  /** Whether the store has more than the window is showing. */
  hasMore: boolean;
}

export const initialWindow = (): HistoryWindow => ({ size: INITIAL_WINDOW, hasMore: true });

/**
 * Whether a scroll position is asking for older messages.
 *
 * `hasMore` is checked here rather than at the call site so a conversation
 * showing everything it has cannot be made to ask again on every scroll event.
 */
export function shouldLoadMore(
  scrollTop: number,
  window: HistoryWindow,
  busy: boolean,
): boolean {
  if (busy || !window.hasMore) return false;
  return scrollTop <= LOAD_MORE_THRESHOLD_PX;
}

/**
 * The next window after a load.
 *
 * `hasMore` is derived from what came back: fewer messages than asked for means
 * the store is exhausted, and asking again would loop forever against a
 * conversation shorter than the window.
 */
export function grow(window: HistoryWindow, received: number): HistoryWindow {
  const requested = window.size;
  return {
    size: window.size + WINDOW_STEP,
    hasMore: received >= requested,
  };
}

/**
 * Keep the reader looking at the same message after older ones are prepended.
 *
 * Inserting above the viewport moves everything down by the height of what was
 * added, so without this the view jumps backwards the moment more arrives —
 * the reader loses their place precisely because they asked for more.
 *
 * @param previousHeight `scrollHeight` before the prepend.
 * @param newHeight      `scrollHeight` after it.
 * @param previousTop    `scrollTop` before it.
 */
export function preservedScrollTop(
  previousHeight: number,
  newHeight: number,
  previousTop: number,
): number {
  return previousTop + (newHeight - previousHeight);
}
