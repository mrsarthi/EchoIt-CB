/**
 * The avatar size ladder does what it claims, measured against a real cap.
 *
 *   npx tsx harness/avatar-shrink.mts
 *
 * `shrinkToFit` is the only part of avatar handling with a decision in it, and
 * it is the part that cannot be checked by looking: whether it stops at the
 * first fitting encode, whether it steps down in size when quality alone is not
 * enough, and whether it refuses rather than returning something the SDK will
 * throw on. Each of those is a way for a profile picture to fail on a real
 * phone with a message the user cannot act on.
 *
 * The encoder is a stand-in that reports a size as a function of edge and
 * quality, so this runs in Node with no canvas and no webview.
 */

import {
  shrinkToFit,
  FIRST_EDGE,
  LAST_EDGE,
  MAX_AVATAR_BYTES,
} from '../src/services/avatar-fit.js';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const bytes = (n: number) => new Uint8Array(n);

/** Records every (edge, quality) asked for, and answers with `size`. */
function spy(size: (edge: number, quality: number) => number) {
  const calls: Array<{ edge: number; quality: number }> = [];
  return {
    calls,
    encode: async (edge: number, quality: number) => {
      calls.push({ edge, quality });
      return bytes(size(edge, quality));
    },
  };
}

// 1. A small picture is taken as it is, with no second encode.
{
  const s = spy(() => 10_000);
  const result = await shrinkToFit(s.encode);
  check('a picture already under the cap is encoded once',
    s.calls.length === 1 && result.attempts === 1,
    `${s.calls.length} encode(s)`);
  check('and at full size and top quality',
    s.calls[0].edge === FIRST_EDGE && s.calls[0].quality === 0.82,
    `edge ${s.calls[0].edge}, q ${s.calls[0].quality}`);
  check('returning bytes that fit',
    result.bytes.byteLength <= MAX_AVATAR_BYTES,
    `${result.bytes.byteLength} <= ${MAX_AVATAR_BYTES}`);
}

// 2. Quality alone rescues a picture that is merely somewhat too big.
{
  // Size falls with quality; at 512 only the lowest quality fits.
  const s = spy((_edge, q) => (q > 0.45 ? MAX_AVATAR_BYTES + 1 : MAX_AVATAR_BYTES - 1));
  const result = await shrinkToFit(s.encode);
  check('quality is lowered before size is',
    result.edge === FIRST_EDGE && result.quality === 0.4,
    `edge ${result.edge}, q ${result.quality}`);
  check('and it stops as soon as one fits',
    s.calls.length === 4, `${s.calls.length} encodes`);
}

// 3. When quality is not enough, the edge halves.
{
  // Nothing fits at 512 whatever the quality; everything fits at 256.
  const s = spy((edge) => (edge >= FIRST_EDGE ? MAX_AVATAR_BYTES * 2 : 1_000));
  const result = await shrinkToFit(s.encode);
  check('a stubborn picture is halved',
    result.edge === FIRST_EDGE / 2, `settled at ${result.edge}px`);
  check('after exhausting quality at the larger size',
    s.calls.filter((c) => c.edge === FIRST_EDGE).length === 4,
    `${s.calls.filter((c) => c.edge === FIRST_EDGE).length} tries at ${FIRST_EDGE}px`);
}

// 4. The ladder is bounded and ends in a refusal, not an oversized result.
{
  const s = spy(() => MAX_AVATAR_BYTES * 3);
  let raised: Error | undefined;
  try {
    await shrinkToFit(s.encode);
  } catch (e) {
    raised = e as Error;
  }
  check('an impossible picture is refused', raised?.name === 'AvatarTooLargeError',
    raised ? raised.name : 'nothing thrown');
  check('the refusal says the actual size',
    !!raised && /\d+KB/.test(raised.message), raised?.message ?? '');
  const smallest = Math.min(...s.calls.map((c) => c.edge));
  check('and it stopped at the smallest edge rather than looping',
    smallest === LAST_EDGE && s.calls.length === 12,
    `${s.calls.length} encodes, down to ${smallest}px`);
}

// 5. The default limit is the SDK's, not a number copied into this file.
{
  const s = spy(() => 300);
  const tight = await shrinkToFit(s.encode, 500);
  check('an explicit limit is honoured', tight.bytes.byteLength <= 500);
  check('the SDK cap is 256KB as the profile service documents',
    MAX_AVATAR_BYTES === 256 * 1024, `${MAX_AVATAR_BYTES} bytes`);
}

console.log(`\n${'─'.repeat(60)}`);
console.log(failures ? `FAIL  ${failures} check(s)` : 'PASS  avatar shrinking behaves as documented');
console.log('─'.repeat(60));
process.exit(failures ? 1 : 0);
