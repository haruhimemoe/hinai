/**
 * @file tests/aborts.test.ts
 * @desc Aborts stay aborts: every method rejects with the signal's reason (never a HinaiError),
 *       whether the abort lands before the headers, while a body is read, or mid-download.
 * @author David @dvhsh (https://dvh.sh)
 * @created Wed Sep 23, 2026
 * @modified Mon Sep 28, 2026
 */

import { describe, expect, it } from "vitest";
import { failure, hang, stalled, stub, zip } from "./helpers/stub-fetch.js";

describe("aborts stay aborts", () => {
  it("getBeatmaps takes a signal and rejects with its reason", async () => {
    const { client } = stub(hang);
    const controller = new AbortController();
    const reason = new Error("stop");
    const pending = failure(client.getBeatmaps([1], { signal: controller.signal }));
    controller.abort(reason);
    expect(await pending).toBe(reason);
  });

  it("while reading a metadata body", async () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    const { client } = stub((_url, init) => {
      setTimeout(() => controller.abort(reason), 5);
      return new Response(stalled(init).body);
    });
    expect(await failure(client.getBeatmaps([1], { signal: controller.signal }))).toBe(reason);
  });

  it("while reading an availability body", async () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    const { client } = stub((_url, init) => {
      setTimeout(() => controller.abort(reason), 5);
      return new Response(stalled(init).body);
    });
    expect(await failure(client.getAvailability(1, { signal: controller.signal }))).toBe(reason);
  });

  it("while reading an error body", async () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    const { client } = stub((_url, init) => {
      setTimeout(() => controller.abort(reason), 5);
      return new Response(stalled(init).body, { status: 503 });
    });
    expect(await failure(client.downloadSet(1, { signal: controller.signal }))).toBe(reason);
  });

  it("mid-stream, even when fetch doesn't cut the body off", async () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    const { body, state } = stalled(undefined, zip());
    const { client } = stub(() => new Response(body));
    const error = await failure(
      client.downloadSet(1, {
        signal: controller.signal,
        onProgress: () => controller.abort(reason),
      }),
    );
    expect(error).toBe(reason);
    expect(state.cancelled).toBe(true);
  });
});
