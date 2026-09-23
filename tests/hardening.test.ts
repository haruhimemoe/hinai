/**
 * @file tests/hardening.test.ts
 * @desc Pre-release hardening: timeouts (a connect timeout only, for downloads), aborts that stay
 *       aborts wherever a body is read, metadata errors read like download errors, URL and id
 *       hygiene, released bodies, an early zip check, requestId and hint, and no User-Agent from
 *       a browser.
 * @author David @dvhsh (https://dvh.sh)
 * @created Wed Sep 23, 2026
 * @modified Wed Sep 23, 2026
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createHinaiClient,
  HINAI_TIMEOUT_MS,
  type HinaiClientOptions,
  HinaiError,
  setDownloadUrl,
} from "../src/index.js";
import batch from "./fixtures/beatmaps-batch.json" with { type: "json" };

type Call = { url: string; init: RequestInit | undefined };
type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

// A client whose fetch answers from `route`, recording every call.
const stub = (route: Route, options: Omit<HinaiClientOptions, "fetch"> = {}) => {
  const calls: Call[] = [];
  const client = createHinaiClient({
    ...options,
    fetch: async (input, init) => {
      calls.push({ url: String(input), init });
      return route(String(input), init);
    },
  });
  return { client, calls };
};
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => error,
  );
const ZIP_HEAD = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
const zip = () => Uint8Array.from([...ZIP_HEAD, 0, 0, 0, 0]);

/** A fetch that never answers; it rejects with the signal's reason on abort, as fetch does. */
const hang: Route = (_url, init) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

/**
 * A body that sends `first` (if any) and then stalls. With `init`, it errors when the request's
 * signal aborts, as fetch's bodies do; without, only the client can stop it. `cancelled` records
 * whether the client released it.
 */
const stalled = (init?: RequestInit, first?: Uint8Array) => {
  const state = { cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (first) controller.enqueue(first);
      init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { body, state };
};

describe("timeouts", () => {
  it("defaults to 10 seconds", () => {
    expect(HINAI_TIMEOUT_MS).toBe(10_000);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("refuses timeoutMs %s", (timeoutMs) => {
    expect(() => createHinaiClient({ timeoutMs })).toThrow(RangeError);
  });

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
    expect(await failure(client.getAvailability(1, controller.signal))).toBe(reason);
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

describe("metadata errors", () => {
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

  it("turns a 404 into a non-retryable not_found and releases the body", async () => {
    const { body, state } = stalled();
    const { client } = stub(() => new Response(body, { status: 404 }));
    const error = await failure(client.getBeatmaps([1]));
    expect(error).toMatchObject({ code: "not_found", status: 404, retryable: false });
    expect((error as Error).message).not.toContain("beatmapset");
    expect(state.cancelled).toBe(true);
  });

  it("calls a 200 that isn't JSON a retryable bad_response", async () => {
    const { client } = stub(() => new Response("<html>"));
    expect(await failure(client.getBeatmaps([1]))).toMatchObject({
      code: "bad_response",
      status: 200,
      retryable: true,
    });
  });
});

describe("URLs and ids", () => {
  it("drops trailing slashes from baseUrl", async () => {
    const { client, calls } = stub(
      (url) => (url.includes("/d/") ? new Response(zip()) : Response.json([])),
      { baseUrl: "https://m.test//" },
    );
    await client.getBeatmaps([1]);
    await client.getAvailability(2).catch(() => undefined);
    await client.downloadSet(3);
    expect(calls.map((call) => call.url)).toEqual([
      "https://m.test/api/v2/beatmaps?ids=1",
      "https://m.test/api/s/2/availability",
      "https://m.test/api/v1/hinai/d/3?noVideo=true",
    ]);
    expect(setDownloadUrl(3, "https://m.test/")).toBe(
      "https://m.test/api/v1/hinai/d/3?noVideo=true",
    );
  });

  it.each(["mirror.example", "ftp://mirror.example", "", "javascript:alert(1)"])(
    "refuses baseUrl %j",
    (baseUrl) => {
      expect(() => createHinaiClient({ baseUrl })).toThrow(RangeError);
    },
  );

  it("never sends ids that aren't positive safe integers, and calls them missing", async () => {
    const { client, calls } = stub(() => Response.json(batch));
    const { found, missing } = await client.getBeatmaps([129891, 1.5, -3, 0, Number.NaN, 1e21]);
    expect(calls.map((call) => new URL(call.url).searchParams.get("ids"))).toEqual(["129891"]);
    expect([...found.keys()]).toEqual([129891]);
    expect(missing).toEqual([1.5, -3, 0, Number.NaN, 1e21]);
  });

  it("makes no request when no id is valid", async () => {
    const { client, calls } = stub(() => Response.json([]));
    expect((await client.getBeatmaps([-1])).missing).toEqual([-1]);
    expect(calls).toEqual([]);
  });

  it.each([0, -1, 1.5, Number.NaN, "1/../../x" as unknown as number])(
    "refuses set id %j before any request",
    async (setId) => {
      const { client, calls } = stub(() => new Response(zip()));
      await expect(client.getAvailability(setId)).rejects.toThrow(RangeError);
      await expect(client.downloadSet(setId)).rejects.toThrow(RangeError);
      expect(() => setDownloadUrl(setId)).toThrow(RangeError);
      expect(calls).toEqual([]);
    },
  );
});

describe("download bodies", () => {
  it("releases the body of a 404 it doesn't read", async () => {
    const { body, state } = stalled();
    const { client } = stub(() => new Response(body, { status: 404 }));
    expect(await failure(client.downloadSet(1))).toMatchObject({ code: "not_found" });
    expect(state.cancelled).toBe(true);
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

describe("requestId and hint", () => {
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

  it("is null when the mirror sent neither", () => {
    expect(new HinaiError("x", "y")).toMatchObject({ requestId: null, hint: null });
  });
});

describe("headers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends no custom headers by default on availability and downloads", async () => {
    const { client, calls } = stub((url) =>
      url.includes("/d/")
        ? new Response(zip())
        : Response.json({
            id: 1,
            availability: { download_disabled: false, more_information: null },
          }),
    );
    await client.getAvailability(1);
    await client.downloadSet(1);
    expect(calls.map((call) => [...new Headers(call.init?.headers).keys()])).toEqual([[], []]);
  });

  it("ignores userAgent in a browser, where it can't be set", async () => {
    vi.stubGlobal("document", {});
    const { client, calls } = stub(() => Response.json([]), { userAgent: "pools" });
    await client.getBeatmaps([1]);
    expect(new Headers(calls[0]?.init?.headers).has("user-agent")).toBe(false);
  });
});
