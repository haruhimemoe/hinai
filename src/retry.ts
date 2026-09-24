/**
 * @file src/retry.ts
 * @desc Retry timing for mirror requests: Retry-After parsing and exponential backoff.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Wed Sep 23, 2026
 */

export const MAX_RETRY_DELAY_MS = 60_000;

/** An HTTP date in the IMF-fixdate form servers send (RFC 9110): Tue, 22 Sep 2026 12:00:03 GMT. */
const IMF_FIXDATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * @function parseRetryAfter
 * @param header {string | null} Retry-After value: delta-seconds or an IMF-fixdate HTTP date
 * @param now {number} current time in ms (Date.now())
 * @returns {number | null} wait in ms, clamped to [0, MAX_RETRY_DELAY_MS]; null when absent or in
 *          any other form (Date.parse alone would read "1.5" or "-5" as a past date, so 0)
 */
export const parseRetryAfter = (header: string | null, now: number): number | null => {
  if (header === null) return null;
  const text = header.trim();
  if (/^\d+$/.test(text)) return Math.min(Number(text) * 1000, MAX_RETRY_DELAY_MS);
  if (!IMF_FIXDATE.test(text)) return null;
  const at = Date.parse(text);
  if (Number.isNaN(at)) return null;
  return Math.min(Math.max(0, at - now), MAX_RETRY_DELAY_MS);
};

/**
 * @function backoffDelayMs
 * @param attempt {number} how many attempts have failed so far (1-based)
 * @param retryAfterMs {number | null} the server's Retry-After, when it sent one
 * @returns {number} ms to wait: the server's value, else 1s, 2s, 4s… capped at MAX_RETRY_DELAY_MS
 */
export const backoffDelayMs = (attempt: number, retryAfterMs: number | null): number =>
  retryAfterMs ?? Math.min(1000 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
