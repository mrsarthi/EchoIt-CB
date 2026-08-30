/**
 * Reading a chosen picture, and showing one that arrived.
 *
 * The DOM half of avatar handling. The size negotiation it delegates to lives
 * in `avatar-fit.ts`, which has no DOM in it and is therefore testable — see
 * the note there.
 */

import { shrinkToFit, type Avatar, type Encoder } from "./avatar-fit";

export * from "./avatar-fit";

/**
 * The real encoder: draw the image onto a canvas and read it back as JPEG.
 *
 * JPEG rather than the source type, because a PNG photograph does not shrink
 * with quality — it has no quality dial — and a profile picture is a
 * photograph far more often than it is line art. Transparency is lost, which
 * for a picture displayed inside a circular mask is not a loss.
 */
async function encoderFor(file: File): Promise<{ encode: Encoder; close: () => void }> {
  const bitmap = await createImageBitmap(file);

  const encode: Encoder = async (edge, quality) => {
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This device could not open a canvas to resize the picture.");
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", quality);
    });
    if (!blob) throw new Error("This device could not encode the picture.");
    return new Uint8Array(await blob.arrayBuffer());
  };

  return { encode, close: () => bitmap.close() };
}

/** Read a chosen file and produce an avatar small enough to publish. */
export async function fileToAvatar(file: File): Promise<Avatar> {
  const { encode, close } = await encoderFor(file);
  try {
    const { bytes } = await shrinkToFit(encode);
    return { mime: "image/jpeg", bytes };
  } finally {
    close();
  }
}

/**
 * A URL for displaying an avatar, and the way to release it.
 *
 * Object URLs are held until revoked. An avatar that is re-rendered on every
 * profile update would leak one per update, which on a long-lived chat screen
 * is a real leak rather than a theoretical one — so the caller is handed the
 * revoke rather than being trusted to remember.
 */
export function avatarUrl(avatar: Avatar): { url: string; revoke: () => void } {
  // Copy into a plain ArrayBuffer: a Uint8Array from the SDK may be a view
  // onto a larger buffer, and Blob would take the whole thing.
  const copy = new Uint8Array(avatar.bytes);
  const url = URL.createObjectURL(new Blob([copy], { type: avatar.mime }));
  return { url, revoke: () => URL.revokeObjectURL(url) };
}
