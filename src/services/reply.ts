/**
 * Replying to one message, or to several at once.
 *
 * ## The field, and the workaround it replaced
 *
 * SDK 0.7.2 added `replyTo?: readonly string[]` to both `SendMessageOptions`
 * and `SdkChatMessage`, so references now travel as their own field.
 *
 * Before that they rode a control line inside `content` — the shape the
 * protocol log had already rejected for profiles, because every client must
 * know to strip it forever and any that does not renders it as literal text.
 * That is gone from the send path.
 *
 * **`decodeLegacyReply` stays, and must.** Messages sent during the workaround
 * are in conversation documents on real devices, permanently: a CRDT does not
 * forget. Removing the reader would show those people a line of machine text in
 * the middle of their own history. It is only ever applied to messages that
 * arrive without the field.
 *
 * ## Why a list rather than a single id
 *
 * Swiping several messages and answering them together was in earlier versions
 * of this app and is the requested behaviour. A single reference would force
 * either one reply per message or an arbitrary "primary" one, and neither is
 * what the person meant.
 *
 * ## Unresolvable references are normal
 *
 * The SDK does not check the ids, and says so: a reply may arrive before the
 * message it answers, or name one this device never received. What to show then
 * is a rendering decision, not an error.
 */

/** A message being replied to, as the composer and the bubble need it. */
export interface ReplyTarget {
  id: string;
  /** Who wrote it, already resolved to a display name. */
  author: string;
  /** A short rendering of the original: its text, or what kind of file it was. */
  preview: string;
}

/**
 * The control line used before SDK 0.7.2 carried references itself.
 *
 * A leading start-of-heading character rather than anything typeable, so no
 * message a person could write is mistaken for one of these.
 */
const LEGACY_MARKER = "\u0001echoit:reply:";

/**
 * Read a message that predates the `replyTo` field.
 *
 * Applied only when the field is absent. Messages sent during the workaround
 * are in people's conversation documents for good, and a CRDT does not forget —
 * dropping this reader would turn their old replies into visible machine text.
 */
export function decodeLegacyReply(raw: string): { replyTo: string[]; content: string } {
  if (!raw.startsWith(LEGACY_MARKER)) return { replyTo: [], content: raw };

  const lineEnd = raw.indexOf("\n");
  // A marker with no newline is malformed. Showing the raw line to a person is
  // worse than showing the message without its quotes, so the marker is
  // dropped and the rest kept.
  if (lineEnd === -1) return { replyTo: [], content: raw.slice(LEGACY_MARKER.length) };

  const ids = raw.slice(LEGACY_MARKER.length, lineEnd).split(",").filter(Boolean);
  return { replyTo: ids, content: raw.slice(lineEnd + 1) };
}

/**
 * A one-line rendering of a message, for the quoted block.
 *
 * Long messages are cut rather than wrapped: a quote taller than the reply
 * turns the conversation into a stack of repeats.
 */
export function previewOfMessage(
  content: string,
  attachments?: readonly { mime: string; name?: string }[],
): string {
  const text = content.trim();
  if (text) return text.length > 90 ? `${text.slice(0, 90)}…` : text;
  if (!attachments || attachments.length === 0) return "Message";

  const [first] = attachments;
  if (attachments.length > 1) return `${attachments.length} files`;
  if (first.mime.startsWith("image/")) return "Photo";
  if (first.mime.startsWith("video/")) return "Video";
  if (first.mime.startsWith("audio/")) return "Audio";
  return first.name ?? "File";
}

/**
 * Add a message to the chain, or remove it if it is already there.
 *
 * Swiping the same message twice should undo, which is the only affordance for
 * changing your mind without clearing the whole chain.
 */
export function toggleTarget(
  chain: readonly ReplyTarget[],
  target: ReplyTarget,
): ReplyTarget[] {
  const at = chain.findIndex((t) => t.id === target.id);
  if (at >= 0) return chain.filter((t) => t.id !== target.id);
  return [...chain, target];
}

/** How many messages one reply may chain. */
export const MAX_CHAIN = 8;
