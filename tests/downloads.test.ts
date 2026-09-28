/**
 * @file tests/downloads.test.ts
 * @desc downloadSet and setDownloadUrl: the streamed no-video archive with progress, video on
 *       request, error statuses, and how bodies are read (the zip check before any progress,
 *       onProgress errors, content-length that turns out short, signatures split across chunks).
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Mon Sep 28, 2026
 */

import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { createHinaiClient, HinaiError, OSZ_MIME, setDownloadUrl } from "../src/index.js";
import { fakeOsz, HINAI_DOWNLOAD_URL } from "./helpers/hinai-downloads.js";
import { setupHinaiServer } from "./helpers/hinai-server.js";
import { failure, stalled, stub, ZIP_HEAD, zip } from "./helpers/stub-fetch.js";

const server = setupHinaiServer();
const client = createHinaiClient();

describe("downloadSet", () => {
  it("streams the no-video archive and reports progress", async () => {
    let requested = "";
    server.use(
      http.get(HINAI_DOWNLOAD_URL, ({ request }) => {
        requested = request.url;
        const bytes = fakeOsz(39804);
        return new HttpResponse(bytes, { headers: { "content-length": String(bytes.byteLength) } });
      }),
    );
    const progress: { loaded: number; total: number | null }[] = [];
    const blob = await client.downloadSet(39804, { onProgress: (p) => progress.push(p) });
    expect(new URL(requested).searchParams.get("noVideo")).toBe("true");
    expect(blob.type).toBe(OSZ_MIME);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(fakeOsz(39804));
    expect(progress.at(-1)).toEqual({ loaded: blob.size, total: blob.size });
  });

  it("keeps hinai's code and the Retry-After on a 429", async () => {
    server.use(
      http.get(HINAI_DOWNLOAD_URL, () =>
        HttpResponse.json(
          { code: "upstream_relay_shed", error: "slow down", retryable: true },
          { status: 429, headers: { "retry-after": "7" } },
        ),
      ),
    );
    await expect(client.downloadSet(1)).rejects.toMatchObject({
      code: "upstream_relay_shed",
      status: 429,
      retryable: true,
      retryAfterMs: 7000,
    });
  });

  it("treats a bare 503 as retryable", async () => {
    server.use(http.get(HINAI_DOWNLOAD_URL, () => new HttpResponse(null, { status: 503 })));
    await expect(client.downloadSet(1)).rejects.toMatchObject({
      code: "http_error",
      status: 503,
      retryable: true,
      retryAfterMs: null,
    });
  });

  it("says when the mirror doesn't have the set (404 without a code)", async () => {
    server.use(
      http.get(HINAI_DOWNLOAD_URL, () =>
        HttpResponse.json(
          { beatmapset_id: 1, error: "beatmapset not found on any mirror", success: false },
          { status: 404 },
        ),
      ),
    );
    await expect(client.downloadSet(1)).rejects.toMatchObject({
      code: "not_found",
      message: "The mirror doesn't have this beatmapset.",
      retryable: false,
    });
  });

  it("rejects a 200 that isn't a zip", async () => {
    server.use(
      http.get(
        HINAI_DOWNLOAD_URL,
        () => new HttpResponse("<html>oops</html>", { headers: { "content-type": "text/html" } }),
      ),
    );
    await expect(client.downloadSet(1)).rejects.toMatchObject({
      code: "bad_response",
      retryable: true,
    });
  });

  it("wraps network failures", async () => {
    server.use(http.get(HINAI_DOWNLOAD_URL, () => HttpResponse.error()));
    const error = await client.downloadSet(1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HinaiError);
    expect(error).toMatchObject({ code: "network", retryable: true });
  });

  it("passes an abort through untouched", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await client
      .downloadSet(39804, { signal: controller.signal })
      .catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(HinaiError);
    expect(error).toMatchObject({ name: "AbortError" });
  });
});

describe("setDownloadUrl", () => {
  it("asks for the no-video archive unless videos are wanted", () => {
    expect(setDownloadUrl(1, "https://m.test")).toBe(
      "https://m.test/api/v1/hinai/d/1?noVideo=true",
    );
    expect(setDownloadUrl(1, "https://m.test", true)).toBe("https://m.test/api/v1/hinai/d/1");
  });
});

describe("downloadSet with videos", () => {
  it("drops noVideo from the request when told to include the video", async () => {
    let requested = "";
    server.use(
      http.get(HINAI_DOWNLOAD_URL, ({ request }) => {
        requested = request.url;
        return new HttpResponse(fakeOsz(39804));
      }),
    );
    await client.downloadSet(39804, { video: true });
    expect(new URL(requested).search).toBe("");
  });
});

describe("download bodies", () => {
  it("turns a download's 404 into a not_found and passes its hint through", async () => {
    const { client } = stub(() =>
      Response.json(
        { code: "beatmapset_unknown", error: "nope", hint: "try later" },
        { status: 404 },
      ),
    );
    expect(await failure(client.downloadSet(1))).toMatchObject({
      code: "not_found",
      hint: "try later",
    });
  });

  it("lets an onProgress error through untouched and stops reading", async () => {
    const { body, state } = stalled(undefined, zip());
    const { client } = stub(() => new Response(body));
    const oops = new Error("render broke");
    const error = await failure(
      client.downloadSet(1, {
        onProgress: () => {
          throw oops;
        },
      }),
    );
    expect(error).toBe(oops);
    expect(state.cancelled).toBe(true);
  });

  it("stops at the first chunk when it isn't a zip", async () => {
    const { body, state } = stalled(undefined, new TextEncoder().encode("<html>oops"));
    const { client } = stub(() => new Response(body));
    const progress: number[] = [];
    const error = await failure(
      client.downloadSet(1, { onProgress: (p) => progress.push(p.loaded) }),
    );
    expect(error).toMatchObject({ code: "bad_response", status: 200, retryable: true });
    expect(state.cancelled).toBe(true);
    expect(progress).toEqual([]);
  });

  it("drops total once a compressing proxy makes loaded pass the encoded content-length", async () => {
    const bytes = Uint8Array.from([...ZIP_HEAD, 1, 2, 3, 4, 5, 6]);
    const { client } = stub(() => new Response(bytes, { headers: { "content-length": "3" } }));
    const progress: (number | null)[] = [];
    await client.downloadSet(1, { onProgress: (p) => progress.push(p.total) });
    expect(progress.at(-1)).toBeNull();
  });

  it("reads a zip signature split across chunks", async () => {
    const { client } = stub(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(Uint8Array.from([0x50, 0x4b]));
              controller.enqueue(Uint8Array.from([0x03, 0x04, 9]));
              controller.close();
            },
          }),
        ),
    );
    expect((await client.downloadSet(1)).size).toBe(5);
  });

  it.each([
    ["shorter than a zip signature", () => new Response(Uint8Array.from([0x50, 0x4b]))],
    ["empty", () => new Response(null)],
  ])("calls a body that's %s a bad_response", async (_name, respond) => {
    const { client } = stub(respond);
    expect(await failure(client.downloadSet(1))).toMatchObject({ code: "bad_response" });
  });
});
