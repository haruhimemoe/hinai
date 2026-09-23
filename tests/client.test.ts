/**
 * @file tests/client.test.ts
 * @desc hinai client: field mapping, missing ids, batching, dedupe, and each failure mode.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Wed Sep 23, 2026
 */

import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { createHinaiClient, HinaiError } from "../src/index.js";
import { HINAI_BATCH_URL, setupHinaiServer } from "./helpers/hinai-server.js";

const server = setupHinaiServer();
const client = createHinaiClient();

describe("getBeatmaps", () => {
  it("maps a hinai row onto BeatmapMeta", async () => {
    const { found, missing } = await client.getBeatmaps([129891]);
    expect(missing).toEqual([]);
    expect(found.get(129891)).toEqual({
      beatmapId: 129891,
      beatmapsetId: 39804,
      mode: "osu",
      title: "FREEDOM DiVE",
      artist: "xi",
      version: "FOUR DIMENSIONS",
      creator: "Nakagawa-Kanon",
      creatorId: 87065,
      cs: 4,
      ar: 9,
      od: 8,
      hp: 6,
      bpm: expect.closeTo(222.22, 2),
      lengthSeconds: 258,
      starRating: expect.closeTo(7.81, 2),
      checksum: "da8aae79c8f3306b5d65ec951874a7fb",
    });
  });

  it("reports ids the mirror doesn't know as missing", async () => {
    const { found, missing } = await client.getBeatmaps([129891, 999999999]);
    expect([...found.keys()]).toEqual([129891]);
    expect(missing).toEqual([999999999]);
  });

  it("makes no request for an empty list", async () => {
    let calls = 0;
    server.use(
      http.get(HINAI_BATCH_URL, () => {
        calls++;
        return HttpResponse.json([]);
      }),
    );
    await client.getBeatmaps([]);
    expect(calls).toBe(0);
  });

  it("dedupes ids and splits more than 100 into batches", async () => {
    const sizes: number[] = [];
    server.use(
      http.get(HINAI_BATCH_URL, ({ request }) => {
        sizes.push((new URL(request.url).searchParams.get("ids") ?? "").split(",").length);
        return HttpResponse.json([]);
      }),
    );
    const ids = [...Array.from({ length: 150 }, (_, i) => i + 1), 1, 2, 3];
    const { missing } = await client.getBeatmaps(ids);
    expect(sizes).toEqual([100, 50]);
    expect(missing).toHaveLength(150);
  });

  it("ignores rows it didn't ask for and rows that don't match the schema", async () => {
    server.use(
      http.get(HINAI_BATCH_URL, () => HttpResponse.json([{ id: 5, junk: true }, { id: 42 }])),
    );
    const { found, missing } = await client.getBeatmaps([5]);
    expect(found.size).toBe(0);
    expect(missing).toEqual([5]);
  });

  it("surfaces hinai's own error code and message", async () => {
    server.use(
      http.get(HINAI_BATCH_URL, () =>
        HttpResponse.json(
          {
            code: "invalid_id",
            error: "`abc` is not a positive beatmap (difficulty) id",
            retryable: false,
          },
          { status: 400 },
        ),
      ),
    );
    await expect(client.getBeatmaps([1])).rejects.toMatchObject({
      name: "HinaiError",
      code: "invalid_id",
      status: 400,
      retryable: false,
    });
  });

  it("treats an unreadable 5xx body as a retryable http_error", async () => {
    server.use(
      http.get(
        HINAI_BATCH_URL,
        () => new HttpResponse("<html>bad gateway</html>", { status: 502 }),
      ),
    );
    await expect(client.getBeatmaps([1])).rejects.toMatchObject({
      code: "http_error",
      status: 502,
      retryable: true,
    });
  });

  it("treats a JSON error that isn't hinai-shaped as http_error, retryable on 5xx", async () => {
    server.use(http.get(HINAI_BATCH_URL, () => HttpResponse.json({ oops: true }, { status: 503 })));
    await expect(client.getBeatmaps([1])).rejects.toMatchObject({
      code: "http_error",
      status: 503,
      retryable: true,
    });
  });

  it("wraps network failures", async () => {
    server.use(http.get(HINAI_BATCH_URL, () => HttpResponse.error()));
    const error = await client.getBeatmaps([1]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HinaiError);
    expect(error).toMatchObject({ code: "network", retryable: true, status: null });
  });

  it("rejects a 200 that isn't an array", async () => {
    server.use(http.get(HINAI_BATCH_URL, () => HttpResponse.json({ hello: "world" })));
    await expect(client.getBeatmaps([1])).rejects.toMatchObject({ code: "bad_response" });
  });

  it("drops a checksum that isn't a 32-char hex md5", async () => {
    const custom = createHinaiClient({
      fetch: async () =>
        new Response(
          JSON.stringify([
            {
              id: 7,
              beatmapset_id: 8,
              mode: "taiko",
              version: "Oni",
              difficulty_rating: 5,
              cs: 5,
              ar: 5,
              accuracy: 6,
              drain: 5,
              bpm: 180,
              total_length: 90.4,
              checksum: "not-a-hash",
              beatmapset: { artist: "a", title: "t", creator: "c", user_id: 3 },
            },
          ]),
        ),
    });
    const meta = (await custom.getBeatmaps([7])).found.get(7);
    expect(meta).toMatchObject({ mode: "taiko", checksum: null, lengthSeconds: 90, creatorId: 3 });
  });
});
