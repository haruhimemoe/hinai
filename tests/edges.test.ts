/**
 * @file tests/edges.test.ts
 * @desc Failure paths the ported tests don't reach: a mirror error body without `retryable`
 *       (falls back to the status), an availability body that isn't JSON, and a download stream
 *       that breaks without an abort.
 * @author David @dvhsh (https://dvh.sh)
 * @created Wed Sep 23, 2026
 * @modified Wed Sep 23, 2026
 */

import { describe, expect, it } from "vitest";
import { createHinaiClient, HinaiError } from "../src/index.js";

const answer = (response: () => Response) => createHinaiClient({ fetch: async () => response() });
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => error,
  );

describe("mirror error bodies without retryable", () => {
  it.each([
    [503, true],
    [400, false],
  ])("metadata: a %i is retryable: %s", async (status, retryable) => {
    const error = await failure(
      answer(() => Response.json({ code: "busy", error: "Busy." }, { status })).getBeatmaps([1]),
    );
    expect(error).toMatchObject({ name: "HinaiError", code: "busy", status, retryable });
  });

  it.each([
    [429, true],
    [400, false],
  ])("downloads: a %i is retryable: %s", async (status, retryable) => {
    const error = await failure(
      answer(() => Response.json({ code: "shed", error: "Slow down." }, { status })).downloadSet(1),
    );
    expect(error).toMatchObject({ code: "shed", status, retryable });
  });
});

describe("unreadable answers", () => {
  it("calls an availability body that isn't JSON a bad response", async () => {
    const error = await failure(answer(() => new Response("<html>")).getAvailability(1));
    expect(error).toMatchObject({ code: "bad_response", retryable: true });
  });

  it("calls a download stream that breaks mid-way an interrupted download", async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]));
        controller.error(new Error("connection reset"));
      },
    });
    const error = await failure(answer(() => new Response(broken)).downloadSet(1));
    expect(error).toBeInstanceOf(HinaiError);
    expect(error).toMatchObject({ code: "network", retryable: true });
  });
});
