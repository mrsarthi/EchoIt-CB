/**
 * "typing…", and when to stop believing it.
 *
 * Pure, so the timing can be tested without a network or a device.
 *
 * ## Why this is ephemeral, and stays ephemeral
 *
 * A typing signal is only true for a couple of seconds and is misleading the
 * moment it is not. Sent as an ordinary message it would be written into the
 * conversation document, replicated to both devices and kept forever — a few
 * thousand permanent entries a day describing something nobody will ever read
 * back. Stream `0x07` delivers it now or not at all.
 *
 * It is still a disclosure: "X is typing" tells someone you are there and
 * composing. The protocol encrypts it and gates it by channel membership
 * exactly like a message, which is the right treatment.
 *
 * ## The two constants
 *
 * A typing signal has no "stopped" counterpart, and deliberately so — a stop
 * message can be lost, and an indicator that latches on because a packet went
 * missing is worse than one that lapses on its own. Instead the signal is
 * repeated while typing continues and expires by itself.
 *
 * That makes the relationship between the two numbers the whole design: the
 * lifetime must comfortably exceed the repeat interval, or the indicator
 * flickers between keystrokes.
 */

/** How often to repeat the signal while someone is still typing. */
export const TYPING_REPEAT_MS = 2_000;

/**
 * How long a received signal is believed.
 *
 * Two and a half repeats. One dropped signal must not blink the indicator off
 * mid-sentence, and a person who stops typing should disappear within a few
 * seconds rather than linger.
 */
export const TYPING_TTL_MS = 5_000;

/** Whether a peer should currently be shown as typing. */
export function isTyping(lastTypingAt: number | undefined, now: number): boolean {
  if (lastTypingAt === undefined) return false;
  return now - lastTypingAt < TYPING_TTL_MS;
}

/**
 * Whether to put another signal on the wire.
 *
 * Called on every keystroke, so most calls must answer no — otherwise a fast
 * typist emits a packet per character.
 */
export function shouldSendTyping(lastSentAt: number | undefined, now: number): boolean {
  if (lastSentAt === undefined) return true;
  return now - lastSentAt >= TYPING_REPEAT_MS;
}

/**
 * What the line under a contact's name should say.
 *
 * Typing outranks presence: someone composing a message is unambiguously
 * present, and "typing…" is the more useful of the two facts. Falling back to
 * the presence phrase keeps a single source for that wording rather than
 * letting the two drift.
 */
export function describeActivity(
  peerIsTyping: boolean,
  presenceLabel: string,
): string {
  return peerIsTyping ? "typing…" : presenceLabel;
}
