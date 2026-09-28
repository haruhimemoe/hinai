/**
 * @file tests/helpers/hinai-server.ts
 * @desc An msw server on the mirror's handlers from @haruhimemoe/hinai/testing (the same ones
 *       apps use), with Vitest's lifecycle hooks registered.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Mon Sep 28, 2026
 */

import { type SetupServer, setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";
import { hinaiHandlers } from "../../src/testing/index.js";

/**
 * @function setupHinaiServer
 * @returns {SetupServer} server with every mirror handler; lifecycle hooks registered
 */
export const setupHinaiServer = (): SetupServer => {
  const server = setupServer(...hinaiHandlers);
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  return server;
};
