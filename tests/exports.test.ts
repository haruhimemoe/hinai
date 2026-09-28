/**
 * @file tests/exports.test.ts
 * @desc The public surface: exactly these runtime exports, and every type export (a removed or
 *       renamed type fails `bun run typecheck`), so a change shows up in review as a semver
 *       question.
 * @author David @dvhsh (https://dvh.sh)
 * @created Wed Sep 23, 2026
 * @modified Mon Sep 28, 2026
 */

import { expect, expectTypeOf, it } from "vitest";
import type {
  AvailabilityOptions,
  BeatmapLookup,
  BeatmapOptions,
  DownloadOptions,
  DownloadProgress,
  HinaiClient,
  HinaiClientOptions,
  HinaiErrorCode,
  SetAvailability,
} from "../src/index.js";
import * as api from "../src/index.js";

it("exports the documented runtime API", () => {
  expect(Object.keys(api).sort()).toMatchInlineSnapshot(`
    [
      "HINAI_BASE_URL",
      "HINAI_BATCH_LIMIT",
      "HINAI_TIMEOUT_MS",
      "HinaiError",
      "MAX_RETRY_DELAY_MS",
      "OSZ_MIME",
      "backoffDelayMs",
      "createHinaiClient",
      "parseRetryAfter",
      "setDownloadUrl",
    ]
  `);
});

it("exports the documented types", () => {
  expectTypeOf<BeatmapLookup["missing"]>().toEqualTypeOf<number[]>();
  expectTypeOf<BeatmapOptions>().toHaveProperty("signal");
  expectTypeOf<SetAvailability["downloadable"]>().toEqualTypeOf<boolean>();
  expectTypeOf<AvailabilityOptions>().toHaveProperty("signal");
  expectTypeOf<DownloadProgress["total"]>().toEqualTypeOf<number | null>();
  expectTypeOf<DownloadOptions>().toHaveProperty("onProgress");
  expectTypeOf<HinaiClientOptions>().toHaveProperty("userAgent");
  expectTypeOf<HinaiClient>().toHaveProperty("downloadSet");
  expectTypeOf<"network">().toExtend<HinaiErrorCode>();
});
