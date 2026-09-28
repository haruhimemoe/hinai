/**
 * @file tests/availability.test.ts
 * @desc getAvailability against the msw mirror: the recorded answer, takedowns with a reason, an
 *       unknown download_disabled, the recorded 404, and a 200 it can't read.
 * @author David @dvhsh (https://dvh.sh)
 * @created Mon Sep 28, 2026
 * @modified Mon Sep 28, 2026
 */

import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { createHinaiClient } from "../src/index.js";
import { HINAI_AVAILABILITY_URL, hinaiUnknownSetHandler } from "../src/testing/index.js";
import { setupHinaiServer } from "./helpers/hinai-server.js";

const server = setupHinaiServer();
const client = createHinaiClient();

const availability = (disabled: boolean | null, info: string | null) => ({
  id: 1,
  availability: { download_disabled: disabled, more_information: info },
  video: null,
  cached: { withVideo: false, noVideo: false },
});

describe("getAvailability", () => {
  it("reads the recorded answer for a normal set", async () => {
    await expect(client.getAvailability(39804)).resolves.toEqual({
      downloadable: true,
      reason: null,
    });
  });

  it("reports a set the mirror won't serve, with its reason", async () => {
    server.use(
      http.get(HINAI_AVAILABILITY_URL, () =>
        HttpResponse.json(availability(true, "DMCA takedown")),
      ),
    );
    await expect(client.getAvailability(1)).resolves.toEqual({
      downloadable: false,
      reason: "DMCA takedown",
    });
  });

  it("treats an unknown download_disabled (null) as downloadable", async () => {
    server.use(http.get(HINAI_AVAILABILITY_URL, () => HttpResponse.json(availability(null, null))));
    await expect(client.getAvailability(1)).resolves.toEqual({
      downloadable: true,
      reason: null,
    });
  });

  it("turns the recorded 404 into a non-retryable not_found", async () => {
    server.use(hinaiUnknownSetHandler);
    await expect(client.getAvailability(999999999)).rejects.toMatchObject({
      name: "HinaiError",
      code: "not_found",
      status: 404,
      retryable: false,
    });
  });

  it("rejects a 200 it can't read", async () => {
    server.use(http.get(HINAI_AVAILABILITY_URL, () => HttpResponse.json({ nope: true })));
    await expect(client.getAvailability(1)).rejects.toMatchObject({
      code: "bad_response",
      retryable: true,
    });
  });
});
