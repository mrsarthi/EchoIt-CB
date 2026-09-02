/**
 * Telling the phone a message arrived, without telling it what the message said.
 *
 * ## Why this exists
 *
 * D2: the lock screen names the sender and nothing else. Putting the text
 * there would undercut the same warning §4.1 gives about an unlocked phone.
 *
 * The native half (`EchoItNotify`, applied by `apply-android-foreground.mjs`)
 * posts the notification. This file is the only caller, and its argument is a
 * display name — never a body — so a future screen cannot accidentally pass
 * `message.text` without rewriting the signature.
 *
 * No-op on desktop, and no-op while EchoIt is on screen: the unread badge
 * already covers that, and a banner over a conversation you are looking at
 * is noise.
 */

const MAX_NAME = 80;

export function senderLabel(name: string): string {
  const cleaned = name.replace(/[\r\n\u2028\u2029]/g, " ").trim();
  if (!cleaned) return "someone";
  return cleaned.length > MAX_NAME ? cleaned.slice(0, MAX_NAME) : cleaned;
}

/** True when a lock-screen notice would tell the user something they cannot see. */
export function shouldAnnounce(): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "hidden";
}

type NotifyBridge = {
  message?: (senderName: string) => void;
  openSleepSettings?: () => void;
};

function bridge(): NotifyBridge | undefined {
  return (globalThis as { EchoItNotify?: NotifyBridge }).EchoItNotify;
}

/** Post "Message from <name>" if the app is not on screen. Never takes a body. */
export function announceIncoming(senderName: string): void {
  if (!shouldAnnounce()) return;
  bridge()?.message?.(senderLabel(senderName));
}

export function canOpenSleepSettings(): boolean {
  return typeof bridge()?.openSleepSettings === "function";
}

/** Opens this app's Android settings, where battery restrictions live. */
export function openSleepSettings(): void {
  bridge()?.openSleepSettings?.();
}
