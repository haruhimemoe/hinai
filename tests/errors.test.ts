/**
 * @file tests/errors.test.ts
 * @desc How error statuses and unreadable bodies become HinaiErrors: the mirror's own code and
 *       hint, http_error and not_found, retryable from the mirror or else from the status, and
 *       bad_response for a success status whose body can't be read.
 * @author David @dvhsh (https://dvh.sh)
 * @created Wed Sep 23, 2026
 * @modified Mon Sep 28, 2026
 */

import { describe, expect, it } from "vitest";
import { HinaiError } from "../src/index.js";
import { failure, stub, ZIP_HEAD } from "./helpers/stub-fetch.js";

describe("the mirror's error bodies", () => {
  it("keeps the mirror's code, hint and Retry-After on a 429", async () => {
    const { client } = stub(() =>
      Response.json(
        { code: "osu_api_shed", error: "Slow down.", hint: "Honor Retry-After.", retryable: true },
        { status: 429, headers: { "retry-after": "7", "x-hinai-request-id": "01REQ" } },
      ),
    );
    expect(await failure(client.getBeatmaps([1]))).toMatchObject({
      name: "HinaiError",
      code: "osu_api_shed",
      status: 429,
      retryable: true,
      retryAfterMs: 7000,
      hint: "Honor Retry-After.",
      requestId: "01REQ",
    });
  });

  it("keeps the mirror's code when hint and retryable are explicitly null", async () => {
    const { client } = stub(() =>
      Response.json(
        { code: "upstream_relay_shed", error: "Slow down.", hint: null, retryable: true },
        { status: 429 },
      ),
    );
    expect(await failure(client.getBeatmaps([1]))).toMatchObject({
      code: "upstream_relay_shed",
      status: 429,
      retryable: true,
      hint: null,
    });
  });

  it.each([
    [503, true],
    [400, false],
  ])("metadata: without retryable, a %i is retryable: %s", async (status, retryable) => {
    const { client } = stub(() => Response.json({ code: "busy", error: "Busy." }, { status }));
    const error = await failure(client.getBeatmaps([1]));
    expect(error).toMatchObject({ name: "HinaiError", code: "busy", status, retryable });
  });

  it.each([
    [429, true],
    [400, false],
  ])("downloads: without retryable, a %i is retryable: %s", async (status, retryable) => {
    const { client } = stub(() => Response.json({ code: "shed", error: "Slow down." }, { status }));
    const error = await failure(client.downloadSet(1));
    expect(error).toMatchObject({ code: "shed", status, retryable });
  });
});

describe("statuses without the mirror's body", () => {
  it("treats a bare 429 as retryable", async () => {
    const { client } = stub(() => new Response(null, { status: 429 }));
    expect(await failure(client.getBeatmaps([1]))).toMatchObject({
      code: "http_error",
      retryable: true,
    });
  });

  it.each([403, 401])("doesn't call an HTML %i page a retryable bad_response", async (status) => {
    const { client } = stub(() => new Response("<html>denied</html>", { status }));
    expect(await failure(client.getBeatmaps([1]))).toMatchObject({
      code: "http_error",
      status,
      retryable: false,
    });
  });
});

describe("404s", () => {
  it("turns a 404 into a non-retryable not_found and passes its hint through", async () => {
    const { client } = stub(() =>
      Response.json(
        { code: "beatmapset_unknown", error: "nope", hint: "try later" },
        { status: 404 },
      ),
    );
    const error = await failure(client.getBeatmaps([1]));
    expect(error).toMatchObject({
      code: "not_found",
      status: 404,
      retryable: false,
      hint: "try later",
    });
    expect((error as Error).message).not.toContain("beatmapset");
  });

  it("keeps a 404's not_found with a null hint when the body doesn't parse", async () => {
    const { client } = stub(() => new Response("<html>", { status: 404 }));
    expect(await failure(client.getBeatmaps([1]))).toMatchObject({
      code: "not_found",
      status: 404,
      hint: null,
    });
  });

  it("keeps a 404's not_found with a null hint when the body parses without one", async () => {
    const { client } = stub(() =>
      Response.json({ code: "beatmapset_unknown", error: "nope" }, { status: 404 }),
    );
    expect(await failure(client.getBeatmaps([1]))).toMatchObject({
      code: "not_found",
      status: 404,
      hint: null,
    });
  });
});

describe("unreadable answers", () => {
  it("calls a metadata 200 that isn't JSON a retryable bad_response", async () => {
    const { client } = stub(() => new Response("<html>"));
    expect(await failure(client.getBeatmaps([1]))).toMatchObject({
      code: "bad_response",
      status: 200,
      retryable: true,
    });
  });

  it("calls an availability body that isn't JSON a bad response", async () => {
    const { client } = stub(() => new Response("<html>"));
    const error = await failure(client.getAvailability(1));
    expect(error).toMatchObject({ code: "bad_response", retryable: true });
  });

  it("calls a download stream that breaks mid-way an interrupted download", async () => {
    const { client } = stub(() => {
      const broken = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(ZIP_HEAD);
          controller.error(new Error("connection reset"));
        },
      });
      return new Response(broken);
    });
    const error = await failure(client.downloadSet(1));
    expect(error).toBeInstanceOf(HinaiError);
    expect(error).toMatchObject({ code: "network", retryable: true });
  });
});
