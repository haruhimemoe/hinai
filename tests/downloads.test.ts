/**
 * @file tests/downloads.test.ts
 * @desc hinai downloads: availability, streamed download with progress, every failure mode, abort.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Tue Sep 22, 2026
 */

import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { createHinaiClient, HinaiError, OSZ_MIME, setDownloadUrl } from "../src/index.js";
import unknown from "./fixtures/availability-unknown.json" with { type: "json" };
import { fakeOsz, HINAI_AVAILABILITY_URL, HINAI_DOWNLOAD_URL } from "./helpers/hinai-downloads.js";
import { setupHinaiServer } from "./helpers/hinai-server.js";

const server = setupHinaiServer();
const downloader = createHinaiClient();

const availability = (disabled: boolean | null, info: string | null) => ({
  id: 1,
  availability: { download_disabled: disabled, more_information: info },
  video: null,
  cached: { withVideo: false, noVideo: false },
});

describe("getAvailability", () => {
  it("reads the recorded answer for a normal set", async () => {
    await expect(downloader.getAvailability(39804)).resolves.toEqual({
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
    await expect(downloader.getAvailability(1)).resolves.toEqual({
      downloadable: false,
      reason: "DMCA takedown",
    });
  });

  it("treats an unknown download_disabled (null) as downloadable", async () => {
    server.use(http.get(HINAI_AVAILABILITY_URL, () => HttpResponse.json(availability(null, null))));
    await expect(downloader.getAvailability(1)).resolves.toEqual({
      downloadable: true,
      reason: null,
    });
  });

  it("turns the recorded 404 into a non-retryable not_found", async () => {
    server.use(http.get(HINAI_AVAILABILITY_URL, () => HttpResponse.json(unknown, { status: 404 })));
    await expect(downloader.getAvailability(999999999)).rejects.toMatchObject({
      name: "HinaiError",
      code: "not_found",
      status: 404,
      retryable: false,
    });
  });

  it("rejects a 200 it can't read", async () => {
    server.use(http.get(HINAI_AVAILABILITY_URL, () => HttpResponse.json({ nope: true })));
    await expect(downloader.getAvailability(1)).rejects.toMatchObject({
      code: "bad_response",
      retryable: true,
    });
  });
});

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
    const blob = await downloader.downloadSet(39804, { onProgress: (p) => progress.push(p) });
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
    await expect(downloader.downloadSet(1)).rejects.toMatchObject({
      code: "upstream_relay_shed",
      status: 429,
      retryable: true,
      retryAfterMs: 7000,
    });
  });

  it("treats a bare 503 as retryable", async () => {
    server.use(http.get(HINAI_DOWNLOAD_URL, () => new HttpResponse(null, { status: 503 })));
    await expect(downloader.downloadSet(1)).rejects.toMatchObject({
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
    await expect(downloader.downloadSet(1)).rejects.toMatchObject({
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
    await expect(downloader.downloadSet(1)).rejects.toMatchObject({
      code: "bad_response",
      retryable: true,
    });
  });

  it("wraps network failures", async () => {
    server.use(http.get(HINAI_DOWNLOAD_URL, () => HttpResponse.error()));
    const error = await downloader.downloadSet(1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HinaiError);
    expect(error).toMatchObject({ code: "network", retryable: true });
  });

  it("passes an abort through untouched", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await downloader
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
    await downloader.downloadSet(39804, { video: true });
    expect(new URL(requested).search).toBe("");
  });
});
