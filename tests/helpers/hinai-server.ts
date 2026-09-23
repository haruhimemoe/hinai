/**
 * @file tests/helpers/hinai-server.ts
 * @desc MSW server for the hinai mirror: the batch endpoint from the recorded fixture (unknown ids
 *       omitted, like the real mirror), plus availability and downloads.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Wed Sep 23, 2026
 */

import { HttpResponse, http } from "msw";
import { type SetupServer, setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";
import batch from "../fixtures/beatmaps-batch.json" with { type: "json" };
import { hinaiDownloadHandlers } from "./hinai-downloads.js";

export const HINAI_BATCH_URL = "https://mirror.hinamizawa.ai/api/v2/beatmaps";

export const hinaiBatchHandler = http.get(HINAI_BATCH_URL, ({ request }) => {
  const ids = new Set(
    (new URL(request.url).searchParams.get("ids") ?? "").split(",").filter(Boolean).map(Number),
  );
  return HttpResponse.json(batch.filter((row) => ids.has(row.id)));
});

/**
 * @function setupHinaiServer
 * @returns {SetupServer} server with the batch handler; lifecycle hooks registered
 */
export const setupHinaiServer = (): SetupServer => {
  const server = setupServer(hinaiBatchHandler, ...hinaiDownloadHandlers);
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  return server;
};
