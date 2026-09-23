/**
 * @file tests/exports.test.ts
 * @desc The public surface: exactly these runtime exports, so an accidental export or removal
 *       shows up in review as a semver question.
 * @author David @dvhsh (https://dvh.sh)
 * @created Wed Sep 23, 2026
 * @modified Wed Sep 23, 2026
 */

import { expect, it } from "vitest";
import * as api from "../src/index.js";

it("exports the documented runtime API", () => {
  expect(Object.keys(api).sort()).toMatchInlineSnapshot(`
    [
      "HINAI_BASE_URL",
      "HINAI_BATCH_LIMIT",
      "HinaiError",
      "MAX_RETRY_DELAY_MS",
      "OSZ_MIME",
      "backoffDelayMs",
      "createHinaiClient",
      "hinaiAvailabilitySchema",
      "hinaiErrorSchema",
      "parseRetryAfter",
      "setDownloadUrl",
    ]
  `);
});
