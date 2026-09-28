/**
 * @file tests/testing.test.ts
 * @desc @haruhimemoe/hinai/testing: fakeOsz is a valid, repeatable zip (checked with fflate and
 *       node's CRC-32), and the handlers answer the client like the mirror.
 * @author David @dvhsh (https://dvh.sh)
 * @created Mon Sep 28, 2026
 * @modified Mon Sep 28, 2026
 */

import { crc32 } from "node:zlib";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createHinaiClient, OSZ_MIME } from "../src/index.js";
import { fakeOsz, hinaiUnknownSetHandler, recordedBeatmaps } from "../src/testing/index.js";
import { setupHinaiServer } from "./helpers/hinai-server.js";

const server = setupHinaiServer();
const client = createHinaiClient();

describe("fakeOsz", () => {
  it("is a zip holding one stand-in .osu file for the set", () => {
    const entries = unzipSync(fakeOsz(39804));
    expect(Object.keys(entries)).toEqual(["39804.osu"]);
    expect(strFromU8(entries["39804.osu"] as Uint8Array)).toBe(
      "osu file format v14\n// set 39804\n",
    );
  });

  it("stores the entry's real CRC-32 in both headers", () => {
    const bytes = fakeOsz(7);
    const view = new DataView(bytes.buffer);
    const expected = crc32("osu file format v14\n// set 7\n");
    const centralAt = view.getUint32(bytes.length - 6, true);
    expect(view.getUint32(14, true)).toBe(expected);
    expect(view.getUint32(centralAt + 16, true)).toBe(expected);
  });

  it("gives the same bytes on every call, and different bytes per set", () => {
    expect(fakeOsz(10)).toEqual(fakeOsz(10));
    expect(fakeOsz(10)).not.toEqual(fakeOsz(20));
  });
});

describe("the handlers", () => {
  it("answer metadata from the recorded rows, leaving unknown ids out", async () => {
    const known = recordedBeatmaps.map((row) => row.id);
    const { found, missing } = await client.getBeatmaps([...known, 999999999]);
    expect([...found.keys()]).toEqual(known);
    expect(missing).toEqual([999999999]);
  });

  it("answer availability for any set, and a download with fakeOsz", async () => {
    await expect(client.getAvailability(123)).resolves.toEqual({
      downloadable: true,
      reason: null,
    });
    const blob = await client.downloadSet(123);
    expect(blob.type).toBe(OSZ_MIME);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(fakeOsz(123));
  });

  it("answer an unknown set with the recorded 404", async () => {
    server.use(hinaiUnknownSetHandler);
    await expect(client.getAvailability(999999999)).rejects.toMatchObject({
      code: "not_found",
      hint: expect.stringContaining("definitive for now"),
    });
  });
});
