/**
 * @file tests/timeouts.test.ts
 * @desc timeoutMs: which values createHinaiClient accepts, metadata and availability timed end to
 *       end (body included), and downloads timed only until their headers arrive.
 * @author David @dvhsh (https://dvh.sh)
 * @created Wed Sep 23, 2026
 * @modified Mon Sep 28, 2026
 */

import { describe, expect, it } from "vitest";
import { createHinaiClient, HINAI_TIMEOUT_MS, HinaiError } from "../src/index.js";
import { failure, hang, stalled, stub, ZIP_HEAD } from "./helpers/stub-fetch.js";

describe("timeoutMs", () => {
  it("defaults to 10 seconds", () => {
    expect(HINAI_TIMEOUT_MS).toBe(10_000);
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    2_147_483_648,
    Number.MAX_SAFE_INTEGER,
  ])("refuses timeoutMs %s", (timeoutMs) => {
    expect(() => createHinaiClient({ timeoutMs })).toThrow(RangeError);
  });

  it("accepts the largest timeoutMs setTimeout can hold without overflowing", () => {
    expect(() => createHinaiClient({ timeoutMs: 2_147_483_647 })).not.toThrow();
  });
});

describe("timed requests", () => {
  it("gives up on a metadata request that takes longer than timeoutMs", async () => {
    const { client } = stub(hang, { timeoutMs: 20 });
    const error = await failure(client.getBeatmaps([1], { signal: new AbortController().signal }));
    expect(error).toBeInstanceOf(HinaiError);
    expect(error).toMatchObject({ code: "timeout", retryable: true, status: null });
  });

  it("counts reading the availability body against the timeout", async () => {
    const { client } = stub((_url, init) => new Response(stalled(init).body), { timeoutMs: 20 });
    expect(await failure(client.getAvailability(1))).toMatchObject({ code: "timeout" });
  });

  it("gives up on a download whose headers don't arrive in time", async () => {
    const { client } = stub(hang, { timeoutMs: 20 });
    expect(await failure(client.downloadSet(1))).toMatchObject({
      code: "timeout",
      retryable: true,
      status: null,
    });
  });

  it("lets a download keep streaming past timeoutMs once the headers are in", async () => {
    const { client } = stub(
      (_url, init) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
              controller.enqueue(ZIP_HEAD);
              setTimeout(() => {
                controller.enqueue(Uint8Array.from([1, 2]));
                controller.close();
              }, 60);
            },
          }),
        ),
      { timeoutMs: 20 },
    );
    const blob = await client.downloadSet(1);
    expect(blob.size).toBe(6);
  });
});
