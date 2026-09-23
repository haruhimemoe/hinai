/**
 * @file tests/helpers/hinai-downloads.ts
 * @desc MSW handlers for hinai availability and .osz downloads. Archives are synthetic zips built
 *       with fflate: real .osz files are copyrighted and never committed.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Wed Sep 23, 2026
 */

import { strToU8, zipSync } from "fflate";
import { HttpResponse, http } from "msw";
import available from "../fixtures/availability-39804.json" with { type: "json" };

export const HINAI_DOWNLOAD_URL = "https://mirror.hinamizawa.ai/api/v1/hinai/d/:setId";
export const HINAI_AVAILABILITY_URL = "https://mirror.hinamizawa.ai/api/s/:setId/availability";

/** A fixed zip timestamp: fflate stamps "now" otherwise, so two calls could differ in bytes. */
const FAKE_OSZ_MTIME = new Date("2026-09-22T00:00:00Z");

/**
 * @function fakeOsz
 * @param setId {number} beatmapset id written into the stand-in .osu file
 * @returns {Uint8Array<ArrayBuffer>} a small valid zip, the same bytes on every call
 */
export const fakeOsz = (setId: number): Uint8Array<ArrayBuffer> =>
  new Uint8Array(
    zipSync(
      { [`${setId}.osu`]: strToU8(`osu file format v14\n// set ${setId}\n`) },
      { mtime: FAKE_OSZ_MTIME },
    ),
  );

export const hinaiDownloadHandlers = [
  http.get(HINAI_AVAILABILITY_URL, ({ params }) =>
    HttpResponse.json({ ...available, id: Number(params.setId) }),
  ),
  http.get(HINAI_DOWNLOAD_URL, ({ params }) => {
    const bytes = fakeOsz(Number(params.setId));
    return new HttpResponse(bytes, {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(bytes.byteLength),
      },
    });
  }),
];
