/**
 * @file tests/inputs.test.ts
 * @desc What the client sends: base URLs, which ids reach the mirror, bad set ids refused before
 *       any request, and headers (none by default; User-Agent only on servers).
 * @author David @dvhsh (https://dvh.sh)
 * @created Wed Sep 23, 2026
 * @modified Mon Sep 28, 2026
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createHinaiClient, setDownloadUrl } from "../src/index.js";
import batch from "./fixtures/beatmaps-batch.json" with { type: "json" };
import { stub, zip } from "./helpers/stub-fetch.js";

describe("base URLs", () => {
  it("talks to another base URL", async () => {
    const { client, calls } = stub(() => Response.json(batch), {
      baseUrl: "https://mirror.example",
    });
    await client.getBeatmaps([5, 6]);
    expect(calls[0]?.url).toBe("https://mirror.example/api/v2/beatmaps?ids=5,6");
  });

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

  it("keeps a path in baseUrl (a mirror behind a proxy prefix)", async () => {
    const { client, calls } = stub(() => Response.json([]), { baseUrl: "https://p.test/hinai/" });
    await client.getBeatmaps([1]);
    expect(calls[0]?.url).toBe("https://p.test/hinai/api/v2/beatmaps?ids=1");
  });

  it.each([
    "mirror.example",
    "ftp://mirror.example",
    "",
    "javascript:alert(1)",
    "javascript:alert(1)//",
    "https://m.example/?k=1",
    "https://m.example/?",
    "https://m.example/#top",
    "https://u:p@m.example",
    "https://u@m.example",
  ])("refuses baseUrl %j, in the client and in setDownloadUrl", (baseUrl) => {
    expect(() => createHinaiClient({ baseUrl })).toThrow(RangeError);
    expect(() => setDownloadUrl(1, baseUrl)).toThrow(RangeError);
  });
});

describe("ids", () => {
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

describe("headers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends no custom headers by default", async () => {
    const { client, calls } = stub((url) =>
      url.includes("/d/")
        ? new Response(zip())
        : url.includes("/api/s/")
          ? Response.json({
              id: 1,
              availability: { download_disabled: false, more_information: null },
            })
          : Response.json(batch),
    );
    await client.getBeatmaps([1]);
    await client.getAvailability(1);
    await client.downloadSet(1);
    expect(calls.map((call) => [...call.headers.keys()])).toEqual([[], [], []]);
  });

  it("sends the User-Agent it's given on every request", async () => {
    const { client, calls } = stub(() => Response.json(batch), { userAgent: "pools (+https://x)" });
    await client.getBeatmaps([1]);
    await client.getAvailability(1).catch(() => undefined);
    await client.downloadSet(1).catch(() => undefined);
    expect(calls.map((call) => call.headers.get("user-agent"))).toEqual([
      "pools (+https://x)",
      "pools (+https://x)",
      "pools (+https://x)",
    ]);
  });

  it.each(["mytool ✨ 1.0", "tool\r\nX-Evil: 1", "tool\n1.0"])(
    "refuses userAgent %j, which fetch would refuse on every request",
    (userAgent) => {
      expect(() => createHinaiClient({ userAgent })).toThrow(RangeError);
    },
  );

  it("doesn't check a userAgent it won't send (in a browser)", () => {
    vi.stubGlobal("document", {});
    expect(() => createHinaiClient({ userAgent: "mytool ✨" })).not.toThrow();
  });

  it("ignores userAgent in a browser, where it can't be set", async () => {
    vi.stubGlobal("document", {});
    const { client, calls } = stub(() => Response.json([]), { userAgent: "pools" });
    await client.getBeatmaps([1]);
    expect(calls[0]?.headers.has("user-agent")).toBe(false);
  });

  it("ignores userAgent in a worker, which has no document either", async () => {
    vi.stubGlobal("self", { importScripts: () => undefined });
    vi.stubGlobal("window", undefined);
    const { client, calls } = stub(() => Response.json([]), { userAgent: "pools" });
    await client.getBeatmaps([1]);
    expect(calls[0]?.headers.has("user-agent")).toBe(false);
  });
});
