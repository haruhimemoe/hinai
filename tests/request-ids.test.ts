/**
 * @file tests/request-ids.test.ts
 * @desc requestId, hint and forensicsUrl: kept on every HinaiError once a response has arrived
 *       (404s, broken-off downloads and timeouts included), and null before one does.
 * @author David @dvhsh (https://dvh.sh)
 * @created Wed Sep 23, 2026
 * @modified Mon Sep 28, 2026
 */

import { describe, expect, it } from "vitest";
import { HinaiError } from "../src/index.js";
import { failure, hang, stalled, stub, ZIP_HEAD } from "./helpers/stub-fetch.js";

const ids = { "x-hinai-request-id": "01GHI", "x-hinai-forensics": "https://f.example/01GHI" };

describe("requestId, hint and forensicsUrl", () => {
  it("carries the request id header and the mirror's hint", async () => {
    const { client } = stub(() =>
      Response.json(
        { code: "upstream_relay_shed", error: "Slow down.", hint: "Try in a minute." },
        { status: 429, headers: { "x-hinai-request-id": "01ABC" } },
      ),
    );
    expect(await failure(client.downloadSet(1))).toMatchObject({
      requestId: "01ABC",
      hint: "Try in a minute.",
    });
  });

  it("carries the forensics header", async () => {
    const { client } = stub(() =>
      Response.json(
        { code: "upstream_relay_shed", error: "Slow down." },
        {
          status: 429,
          headers: { "x-hinai-forensics": "https://mirror.hinamizawa.ai/api/v1/hinai/f/01ABC" },
        },
      ),
    );
    expect(await failure(client.downloadSet(1))).toMatchObject({
      forensicsUrl: "https://mirror.hinamizawa.ai/api/v1/hinai/f/01ABC",
    });
  });

  it("carries the request id on a 404", async () => {
    const { client } = stub(
      () => new Response(null, { status: 404, headers: { "x-hinai-request-id": "01DEF" } }),
    );
    expect(await failure(client.getAvailability(1))).toMatchObject({
      code: "not_found",
      requestId: "01DEF",
      hint: null,
    });
  });

  it("carries both on a download that breaks off mid-stream", async () => {
    const { client } = stub(() => {
      const broken = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(ZIP_HEAD);
          controller.error(new Error("connection reset"));
        },
      });
      return new Response(broken, { headers: ids });
    });
    expect(await failure(client.downloadSet(1))).toMatchObject({
      code: "network",
      requestId: "01GHI",
      forensicsUrl: "https://f.example/01GHI",
    });
  });
});

describe("requestId and forensicsUrl on timeouts", () => {
  it("carries both on a timeout while a body is read", async () => {
    const { client } = stub((_url, init) => new Response(stalled(init).body, { headers: ids }), {
      timeoutMs: 20,
    });
    expect(await failure(client.getAvailability(1))).toMatchObject({
      code: "timeout",
      status: null,
      requestId: "01GHI",
      forensicsUrl: "https://f.example/01GHI",
    });
  });

  it("carries both on a timeout while an error body is read", async () => {
    const { client } = stub(
      (_url, init) => new Response(stalled(init).body, { status: 503, headers: ids }),
      { timeoutMs: 20 },
    );
    expect(await failure(client.downloadSet(1))).toMatchObject({
      code: "timeout",
      requestId: "01GHI",
      forensicsUrl: "https://f.example/01GHI",
    });
  });

  it("has neither on a timeout before any response", async () => {
    const { client } = stub(hang, { timeoutMs: 20 });
    expect(await failure(client.getBeatmaps([1]))).toMatchObject({
      code: "timeout",
      requestId: null,
      forensicsUrl: null,
    });
  });

  it("is null when the mirror sent neither", () => {
    expect(new HinaiError("x", "y")).toMatchObject({
      requestId: null,
      hint: null,
      forensicsUrl: null,
    });
  });
});
