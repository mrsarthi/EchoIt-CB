/**
 * Deciding how small a profile picture has to be, with no picture in sight.
 *
 * ## The cap is not advisory
 *
 * `setMyProfile` throws `ProfileTooLargeError` above 256KB, and the SDK is
 * right to: a profile replicates to every contact, so one 12MB photo is 12MB
 * sent to each of them, again on every edit. But a phone camera produces
 * several megabytes as a matter of course, so a cap enforced by refusal would
 * reject nearly every real photograph. The picture has to be shrunk, not
 * rejected.
 *
 * ## Why it retries rather than computing a quality
 *
 * There is no way to predict the encoded size of an image: it depends on the
 * content. A flat colour and a photograph of leaves at the same dimensions and
 * the same quality differ by an order of magnitude. So this encodes, measures,
 * and lowers quality until it fits — and when quality alone is not enough,
 * halves the dimensions and starts again. Measured, not estimated.
 *
 * The ladder is bounded. If a picture cannot be made to fit at the smallest
 * size tried, that is reported rather than silently shipping something that
 * `setMyProfile` will throw on.
 *
 * ## Why this is a separate file
 *
 * `canvas` and `createImageBitmap` exist only in a browser, which would put the
 * size negotiation — the one part with a decision in it — beyond the reach of
 * any test that does not boot a webview. So the negotiation lives here, takes
 * an encoder, and never touches the DOM; `avatar.ts` supplies the real encoder
 * and the display side. Same split, and the same reason, as
 * `attachment-format.ts` against `attachments.ts`.
 */

import { MAX_AVATAR_BYTES } from "@dicsussion/sdk";

export { MAX_AVATAR_BYTES };

/** A picture as the profile service wants it. */
export interface Avatar {
  readonly mime: string;
  readonly bytes: Uint8Array;
}

/**
 * Renders a source image at a given edge length and quality.
 *
 * @param edge Longest side in pixels. Aspect ratio is the encoder's business.
 * @param quality 0..1, as the canvas encoders use it.
 */
export type Encoder = (edge: number, quality: number) => Promise<Uint8Array>;

/**
 * Longest edge tried first.
 *
 * An avatar is displayed at perhaps 96px, and twice that again on a dense
 * screen. 512 leaves room for a profile page to show it larger without being
 * the reason the picture needs shrinking.
 */
export const FIRST_EDGE = 512;

/** Smallest edge worth producing. Below this it is no longer a picture. */
export const LAST_EDGE = 128;

/** Quality steps tried at each size, in order. */
const QUALITIES = [0.82, 0.7, 0.55, 0.4];

/** What the ladder did, so a caller can say something specific. */
export interface ShrinkResult {
  readonly bytes: Uint8Array;
  readonly edge: number;
  readonly quality: number;
  /** How many encodes it took. Useful in tests, and in a log. */
  readonly attempts: number;
}

/**
 * Encode at descending size and quality until the result fits.
 *
 * @throws If even the smallest attempt exceeds `limit`.
 */
export async function shrinkToFit(
  encode: Encoder,
  limit: number = MAX_AVATAR_BYTES,
): Promise<ShrinkResult> {
  let attempts = 0;
  let smallest: ShrinkResult | undefined;

  for (let edge = FIRST_EDGE; edge >= LAST_EDGE; edge = Math.floor(edge / 2)) {
    for (const quality of QUALITIES) {
      const bytes = await encode(edge, quality);
      attempts += 1;
      const candidate = { bytes, edge, quality, attempts };
      if (bytes.byteLength <= limit) return candidate;
      // Keep the best failure so the error can say how close it got.
      if (!smallest || bytes.byteLength < smallest.bytes.byteLength) {
        smallest = candidate;
      }
    }
  }

  const got = smallest ? smallest.bytes.byteLength : 0;
  throw Object.assign(
    new Error(
      `That picture could not be made small enough — ${Math.round(got / 1024)}KB `
      + `at the smallest size tried, against a ${Math.round(limit / 1024)}KB limit.`,
    ),
    { name: "AvatarTooLargeError" },
  );
}

