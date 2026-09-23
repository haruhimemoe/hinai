/**
 * @file tests/options.test.ts
 * @desc Options packs' clients didn't have: one client for metadata and downloads, a User-Agent
 *       sent only when given (browsers can't set one, and extra headers force a preflight), and
 *       a custom base URL.
 * @author David @dvhsh (https://dvh.sh)
 * @created Wed Sep 23, 2026
 * @modified Wed Sep 23, 2026
 */

import { describe, expect, it } from "vitest";
import { createHinaiClient } from "../src/index.js";
import batch from "./fixtures/beatmaps-batch.json" with { type: "json" };

type Seen = { url: string; headers: Headers };
const recording = (seen: Seen[]) => async (input: string | URL, init?: RequestInit) => {
  seen.push({ url: String(input), headers: new Headers(init?.headers) });
  return Response.json(batch);
};

describe("createHinaiClient options", () => {
  it("sends no headers by default", async () => {
    const seen: Seen[] = [];
    await createHinaiClient({ fetch: recording(seen) }).getBeatmaps([1]);
    expect([...(seen[0]?.headers.keys() ?? [])]).toEqual([]);
  });

  it("sends the User-Agent it's given on every request", async () => {
    const seen: Seen[] = [];
    const client = createHinaiClient({ fetch: recording(seen), userAgent: "pools (+https://x)" });
    await client.getBeatmaps([1]);
    await client.getAvailability(1).catch(() => undefined);
    await client.downloadSet(1).catch(() => undefined);
    expect(seen.map((request) => request.headers.get("user-agent"))).toEqual([
      "pools (+https://x)",
      "pools (+https://x)",
      "pools (+https://x)",
    ]);
  });

  it("talks to another base URL", async () => {
    const seen: Seen[] = [];
    await createHinaiClient({
      fetch: recording(seen),
      baseUrl: "https://mirror.example",
    }).getBeatmaps([5, 6]);
    expect(seen[0]?.url).toBe("https://mirror.example/api/v2/beatmaps?ids=5,6");
  });
});
