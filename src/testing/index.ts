/**
 * @file src/testing/index.ts
 * @desc @haruhimemoe/hinai/testing: msw handlers that answer like the mirror (from answers
 *       recorded from it), the recorded answers themselves, and fakeOsz, so an app's tests mock
 *       the mirror the way this package's own tests do. Needs msw 2 (an optional peer).
 * @author David @dvhsh (https://dvh.sh)
 * @created Mon Sep 28, 2026
 * @modified Mon Sep 28, 2026
 */

import { HttpResponse, http } from "msw";
import { HINAI_BASE_URL } from "../client.js";
import { recordedAvailability, recordedBeatmaps, recordedUnknownSet } from "./fixtures.js";
import { fakeOsz } from "./osz.js";

export * from "./fixtures.js";
export { fakeOsz } from "./osz.js";

/** The metadata endpoint on the default mirror (msw ignores its `ids` query when matching). */
export const HINAI_BATCH_URL = `${HINAI_BASE_URL}/api/v2/beatmaps`;
/** The availability endpoint on the default mirror, as an msw path with a `:setId` param. */
export const HINAI_AVAILABILITY_URL = `${HINAI_BASE_URL}/api/s/:setId/availability`;
/** The download endpoint on the default mirror, as an msw path with a `:setId` param. */
export const HINAI_DOWNLOAD_URL = `${HINAI_BASE_URL}/api/v1/hinai/d/:setId`;

/** Answers metadata from recordedBeatmaps: the rows asked for; the mirror leaves unknown ids out. */
export const hinaiBatchHandler = http.get(HINAI_BATCH_URL, ({ request }) => {
  const asked = new URL(request.url).searchParams.getAll("ids").join(",");
  const ids = new Set(asked.split(",").map(Number));
  return HttpResponse.json(recordedBeatmaps.filter((row) => ids.has(row.id)));
});

/** Answers availability with recordedAvailability (downloadable), for whichever set is asked. */
export const hinaiAvailabilityHandler = http.get(HINAI_AVAILABILITY_URL, ({ params }) =>
  HttpResponse.json({ ...recordedAvailability, id: Number(params.setId) }),
);

/** Answers availability with the recorded 404 for an unknown set. Install it with `server.use`. */
export const hinaiUnknownSetHandler = http.get(HINAI_AVAILABILITY_URL, () =>
  HttpResponse.json(recordedUnknownSet, { status: 404 }),
);

/** Answers downloads with fakeOsz(setId), with a content-length. */
export const hinaiDownloadHandler = http.get(HINAI_DOWNLOAD_URL, ({ params }) => {
  const bytes = fakeOsz(Number(params.setId));
  return new HttpResponse(bytes, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(bytes.byteLength),
    },
  });
});

/** Availability and downloads: what a download flow needs. */
export const hinaiDownloadHandlers = [hinaiAvailabilityHandler, hinaiDownloadHandler];

/** Every endpoint the client calls: pass them to msw's `setupServer` or `setupWorker`. */
export const hinaiHandlers = [hinaiBatchHandler, ...hinaiDownloadHandlers];
