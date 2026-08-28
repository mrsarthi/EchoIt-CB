/**
 * Who gets the back button.
 *
 * ## Why this exists rather than two listeners
 *
 * `MediaViewer` and `AppShell` both need to react to `echoit:back`, and only
 * the topmost should. The first attempt gave the viewer a listener registered
 * with `{ capture: true }` and had it call `stopImmediatePropagation()`, on the
 * assumption that capture runs first.
 *
 * It does not. The event is dispatched **directly on `window`**, so `window` is
 * the target, and listeners on the target are invoked in *registration order* —
 * the capture flag only orders listeners on ancestors, of which there are none.
 * `AppShell` mounts first, so its handler ran first and navigated away; by the
 * time the viewer stopped propagation the damage was done.
 *
 * Reported as: zoomed into a photo, pressing the phone's back button "throws me
 * out to the chats page instead of the chat window where the image was shared"
 * — both handlers ran.
 *
 * A stack removes the guesswork. The most recently pushed handler is asked
 * first, and the first one to claim the press ends it. That matches how a stack
 * of screens behaves, and it does not depend on mount order, event phases, or
 * anything else invisible at the call site.
 */

/** Return `true` to claim the press; `false` to pass it down the stack. */
export type BackHandler = () => boolean;

const handlers: BackHandler[] = [];
let listening = false;

function onBack() {
  // Newest first: the thing on top of the screen is the thing back should act
  // on. A copy, because a handler may unregister itself while running.
  for (const handler of [...handlers].reverse()) {
    try {
      if (handler()) return;
    } catch {
      // A broken handler must not swallow the press and strand the user on a
      // screen with no way out; fall through to the one beneath it.
    }
  }
}

/**
 * Take the back button until the returned function is called.
 *
 * Push on mount, call the result on unmount. Handlers pushed later win.
 */
export function pushBackHandler(handler: BackHandler): () => void {
  handlers.push(handler);

  if (!listening) {
    // Reached through globalThis rather than the `window` global so this
    // module carries no dependency on DOM types — the test drives it with a
    // stand-in window and needs no browser to run.
    const host = (globalThis as { window?: { addEventListener(t: string, fn: () => void): void } }).window;
    if (host) {
      host.addEventListener("echoit:back", onBack);
      listening = true;
    }
  }

  return () => {
    const at = handlers.indexOf(handler);
    if (at >= 0) handlers.splice(at, 1);
  };
}

/** How many handlers are registered. For tests and diagnostics. */
export function backHandlerCount(): number {
  return handlers.length;
}
