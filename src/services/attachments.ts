/**
 * Sending and fetching files, on top of the SDK's content-addressed blobs.
 *
 * ## Why a handle rather than the bytes
 *
 * A message carries a `BlobRef` — a hash, a size, a media type — and nothing
 * else. The bytes stay put until someone asks for them. The alternative is
 * base64 in the message body, which is a third larger than the file, enters the
 * conversation document permanently, loads whole into memory on both sides, and
 * cannot be deleted afterwards. A handful of phone photos would outweigh every
 * sentence in a conversation, forever.
 *
 * Blobs are named by the hash of their content, so the same file is stored once
 * however many times it arrives, and a recipient can tell whether what arrived
 * is what was sent.
 *
 * ## Failures are distinguishable on purpose
 *
 * "Could not attach that" is not something an app can put in front of a person.
 * The SDK raises three different errors and `describeBlobError` turns each into
 * something a person can act on. Anything else is reported as itself rather
 * than flattened into a generic message.
 */

import type { EchoItClient } from "../transport/create-client";
import { formatSize, MAX_ATTACHMENT_BYTES } from "./attachment-format";

/** A handle to blob content, as it travels in a message. */
export interface Attachment {
  readonly hash: string;
  readonly size: number;
  readonly mime: string;
  /** What the sender called it. Not part of the ref; carried alongside. */
  readonly name?: string;
}

export {
  MAX_ATTACHMENT_BYTES,
  isViewable,
  formatSize,
  describeBlobError,
} from "./attachment-format";

/**
 * Store a file locally and return the handle to put in a message.
 *
 * The size is checked before `put` so an oversized file is refused with a
 * useful sentence instead of after the bytes have been read and hashed.
 */
export async function putAttachment(
  client: EchoItClient,
  file: File,
): Promise<Attachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return Promise.reject(
      Object.assign(new Error(`That file is too big. The limit is ${formatSize(MAX_ATTACHMENT_BYTES)}.`), {
        name: "BlobTooLargeError",
      }),
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Some pickers hand back an empty type for unusual extensions. The protocol
  // does not care, but the receiver decides how to render from this.
  const mime = file.type || "application/octet-stream";
  const ref = await client.client.blobs.put(bytes, mime);
  return { hash: ref.hash, size: ref.size, mime: ref.mime, name: file.name };
}

/**
 * Object URLs for attachments, kept for the session and shared by hash.
 *
 * The first version revoked on unmount, reasoning that an object URL pins its
 * blob for the lifetime of the document. That is true, and it produced a bug
 * you could see: leaving a conversation revoked the URL, returning re-rendered
 * an `img` still pointing at it, and the bubble showed a broken-image icon.
 * Measured — `fetch` on the URL failed and `naturalWidth` was 0.
 *
 * The mistake was tying a *document-lifetime* resource to a *component*
 * lifetime. Keyed by content hash instead: created once, shared by every
 * bubble and the viewer, and released together when the client goes away.
 *
 * Growth is bounded by what the user actually opened — nothing is fetched
 * without a tap, and identical content is one entry however many times it was
 * sent.
 */
const urlCache = new Map<string, string>();

/**
 * The bytes as a URL the DOM can show, fetching them if this is the first ask.
 *
 * `onProgress` fires while bytes arrive. An interrupted transfer resumes from
 * where it stopped rather than starting again, so a percentage that pauses and
 * continues is normal.
 */
export async function attachmentUrl(
  client: EchoItClient,
  attachment: Attachment,
  onProgress?: (received: number, total: number) => void,
): Promise<string> {
  const cached = urlCache.get(attachment.hash);
  if (cached) return cached;

  const ref = { hash: attachment.hash, size: attachment.size, mime: attachment.mime };

  let stopWatching: (() => void) | undefined;
  if (onProgress) {
    try {
      const off = client.client.blobs.onProgress(ref, onProgress);
      if (typeof off === "function") stopWatching = off;
    } catch {
      // No progress bar is a worse experience, not a failure. Let the transfer
      // either arrive or raise something nameable.
    }
  }

  try {
    const bytes = await client.client.blobs.get(ref);
    const url = URL.createObjectURL(
      new Blob([bytes as unknown as ArrayBufferView], { type: attachment.mime }),
    );
    // Another caller may have won the race while this awaited. Keep theirs and
    // drop ours, so one hash never has two live URLs.
    const existing = urlCache.get(attachment.hash);
    if (existing) {
      URL.revokeObjectURL(url);
      return existing;
    }
    urlCache.set(attachment.hash, url);
    return url;
  } finally {
    stopWatching?.();
  }
}

/**
 * Release every attachment URL.
 *
 * Called when the client is torn down. Individual components must not do this:
 * they do not know whether anything else is still showing the same file.
 */
export function releaseAttachmentUrls(): void {
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
}

/** Whether the bytes are already here, so the UI can skip asking the network. */
export async function haveAttachment(
  client: EchoItClient,
  attachment: Attachment,
): Promise<boolean> {
  try {
    return await client.client.blobs.has({
      hash: attachment.hash,
      size: attachment.size,
      mime: attachment.mime,
    });
  } catch {
    return false;
  }
}

/**
 * Write an attachment to the device and hand it to whatever opens that type.
 *
 * This is the one path in the app that puts plaintext on disk outside the SDK's
 * encrypted store. It happens only on an explicit tap, which is what makes it
 * an exception rather than a leak — the same status as any file saved from a
 * browser. Nothing here runs on its own.
 *
 * Two steps, and the second is allowed to fail on its own terms: the file is
 * saved either way, and "saved but nothing could open it" is a genuinely
 * different outcome from "could not save it". A PDF on a phone with no PDF
 * reader is the ordinary case for the second.
 *
 * @returns The path written, so the caller can say where it went.
 */
export async function saveToDevice(
  client: EchoItClient,
  attachment: Attachment,
  options: { open?: boolean } = {},
): Promise<{ path: string; opened: boolean; openError?: string }> {
  const ref = { hash: attachment.hash, size: attachment.size, mime: attachment.mime };
  const bytes = await client.client.blobs.get(ref);

  const { invoke } = await import("@tauri-apps/api/core");
  const path = await invoke<string>("save_attachment", {
    fileName: attachment.name ?? suggestName(attachment),
    // Tauri's IPC does not carry a Uint8Array; a plain array of numbers does.
    bytes: Array.from(bytes as Uint8Array),
  });

  if (!options.open) return { path, opened: false };

  try {
    const { openPath } = await import("@tauri-apps/plugin-opener");
    await openPath(path);
    return { path, opened: true };
  } catch (error) {
    // Saved, but nothing on the device claims this type. Worth saying plainly
    // rather than reporting the save as a failure.
    return { path, opened: false, openError: (error as Error).message };
  }
}

/**
 * A filename for something that arrived without one.
 *
 * The hash is unique and stable, so re-saving the same file twice produces the
 * same name rather than a pile of near-duplicates.
 */
export function suggestName(attachment: Attachment): string {
  const extension = attachment.mime.split("/")[1]?.split(";")[0] ?? "bin";
  return `echoit-${attachment.hash.slice(0, 12)}.${extension}`;
}
