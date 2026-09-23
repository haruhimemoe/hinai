/**
 * @file tests/retry.test.ts
 * @desc Retry-After parsing (seconds and HTTP dates) and exponential backoff.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Tue Sep 22, 2026
 */

import { describe, expect, it } from "vitest";
import { backoffDelayMs, MAX_RETRY_DELAY_MS, parseRetryAfter } from "../src/index.js";

const NOW = Date.parse("2026-09-22T12:00:00Z");

describe("parseRetryAfter", () => {
  it.each([
    [null, null],
    ["", null],
    ["soon", null],
    ["0", 0],
    ["5", 5000],
    [" 7 ", 7000],
    ["120", MAX_RETRY_DELAY_MS],
    ["Tue, 22 Sep 2026 12:00:03 GMT", 3000],
    ["Tue, 22 Sep 2026 11:59:00 GMT", 0],
  ])("%j → %j", (header, ms) => {
    expect(parseRetryAfter(header, NOW)).toBe(ms);
  });
});

describe("backoffDelayMs", () => {
  it.each([
    [1, 1000],
    [2, 2000],
    [3, 4000],
    [10, MAX_RETRY_DELAY_MS],
  ])("attempt %d waits %dms", (attempt, ms) => {
    expect(backoffDelayMs(attempt, null)).toBe(ms);
  });

  it("prefers the server's Retry-After, even zero", () => {
    expect(backoffDelayMs(1, 5000)).toBe(5000);
    expect(backoffDelayMs(3, 0)).toBe(0);
  });
});
