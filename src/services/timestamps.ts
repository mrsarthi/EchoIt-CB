/**
 * Turning what the SDK stores into a time a person can read.
 *
 * Deliberately free of SDK imports: this is a pure function, and keeping it
 * that way lets `harness/timestamp-units.mts` test it without a network, a
 * device, or the SDK's type resolution.
 */

/**
 * Normalise an SDK timestamp to milliseconds.
 *
 * The SDK reports `timestamp` in **seconds**; `new Date()` wants milliseconds.
 * Feeding it seconds put every message in January 1970 and, worse, collapsed
 * the gaps between them: three messages sent three seconds apart came out three
 * *milliseconds* apart and rendered as the same clock time. Reported as "the
 * timing on the msgs always shows 10:03 pm".
 *
 * Measured against the SDK:
 *
 *   wall = 1787801421537 (ms)   reported = 1787801421 (s)
 *
 * The threshold distinguishes the two units rather than assuming: a
 * seconds-based stamp for any plausible date is far below 1e12, a
 * millisecond-based one far above. That keeps this correct if a future SDK
 * switches to milliseconds, instead of moving the bug by a factor of a thousand.
 *
 * No timezone is involved. A Unix epoch names an absolute instant; rendering
 * with `toLocaleTimeString()` and no explicit zone lets every reader see it in
 * their own, which is why a sender in Kolkata and a reader in New York see the
 * same moment described differently rather than one of them seeing it wrong.
 */
const MILLIS_THRESHOLD = 1e12;

export function toMillis(timestamp: number): number {
  return timestamp < MILLIS_THRESHOLD ? timestamp * 1000 : timestamp;
}
