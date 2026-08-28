/**
 * Describing attachments to people. No DOM, no SDK.
 *
 * Split out for the same reason as `timestamps.ts`: these are the parts worth
 * testing, and a harness that has to pull in DOM types and a transport to check
 * a sentence is a harness nobody runs.
 */

/**
 * The protocol's cap. Not the app's.
 *
 * A literal rather than an import so a future SDK renaming its export cannot
 * silently raise our limit — the SDK will refuse at its own cap regardless.
 */
export const PROTOCOL_MAX_BYTES = 64 * 1024 * 1024;

/**
 * What this app will actually accept.
 *
 * **Provisional, pending a real two-phone measurement.**
 *
 * The protocol says 64MB. Measured with both peers in one process (an unfair
 * arrangement — they share a thread — so read it as a floor, not a rate):
 *
 *     1 MB    4.5s      8 MB   37.1s
 *    32 MB  157.2s     64 MB   FAILED, BlobUnavailableError
 *
 * 64MB did not complete at all: it reached the 30s stall timeout, and the
 * error a person would have seen is "nobody who has this file is online",
 * which is both wrong and unactionable. Advertising a limit that fails is
 * worse than a smaller one that holds.
 *
 * 16MB covers photos comfortably and refuses what would stall. Raise it when a
 * transfer between two phones says it is safe to — `harness/blob-throughput.mts`
 * is the measurement, and its own header explains why its number is not the one
 * that decides this.
 */
export const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;

/** Renderable inline. Anything else is offered as a file. */
export function isViewable(mime: string): boolean {
  return mime.startsWith("image/") || mime.startsWith("video/");
}

/** A size a person can read. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Turn a blob failure into something worth showing someone.
 *
 * The SDK raises three named errors and they mean genuinely different things,
 * leading to different actions: shrink it, wait, or try again. Collapsing them
 * into "could not attach that" would waste a distinction the protocol went to
 * trouble to provide.
 *
 * Anything unrecognised is reported as itself. A generic sentence here would
 * hide exactly the case worth reading.
 */
export function describeBlobError(error: unknown): string {
  const name = (error as { name?: string })?.name ?? "";
  const message = (error as { message?: string })?.message ?? String(error);

  if (name === "BlobTooLargeError" || /too large/i.test(message)) {
    return `That file is too big. The limit is ${formatSize(MAX_ATTACHMENT_BYTES)}.`;
  }
  if (name === "BlobStalledError" || /stall/i.test(message)) {
    return "The transfer stopped partway. It resumes where it left off — try again.";
  }
  if (name === "BlobUnavailableError" || /unavailable/i.test(message)) {
    return "Not available yet — nobody who has this file is online. Try later.";
  }
  if (name === "BlobCorruptError" || /corrupt/i.test(message)) {
    return "Download failed and the file did not match its checksum. Try again.";
  }
  return message || "Could not transfer that file.";
}

/**
 * What a conversation row should say when the newest message is a file.
 *
 * An attachment sent with no caption has empty content, and the chat list fell
 * back to "No messages yet" for it — so a conversation whose most recent event
 * was a photo claimed nothing had ever been sent. Seen on a device.
 *
 * The reference apps name the kind of thing rather than leaving it blank, which
 * is also what makes a list of conversations scannable.
 *
 * Returns an empty string when there is genuinely nothing, so the caller keeps
 * its own "No messages yet" for a conversation that really is empty.
 */
export function previewOf(
  content: string,
  attachments?: readonly { mime: string; name?: string }[],
): string {
  const text = content.trim();
  if (text) return text;
  if (!attachments || attachments.length === 0) return "";

  if (attachments.length > 1) return `${attachments.length} files`;

  const [only] = attachments;
  if (only.mime.startsWith("image/")) return "Photo";
  if (only.mime.startsWith("video/")) return "Video";
  if (only.mime.startsWith("audio/")) return "Audio";
  // A name is more use than a media type nobody recognises.
  return only.name ?? "File";
}
