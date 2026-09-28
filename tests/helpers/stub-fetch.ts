/**
 * @file tests/helpers/stub-fetch.ts
 * @desc Stub-fetch building blocks for tests that don't need msw: a client whose fetch answers
 *       from a route and records every call, a fetch that never answers, a body that stalls, a
 *       tiny zip, and `failure` to read what a promise rejected with.
 * @author David @dvhsh (https://dvh.sh)
 * @created Mon Sep 28, 2026
 * @modified Mon Sep 28, 2026
 */

import { createHinaiClient, type HinaiClientOptions } from "../../src/index.js";

/** One request the stub fetch saw, with its headers already parsed. */
export type Call = { url: string; init: RequestInit | undefined; headers: Headers };
export type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** The zip signature (`PK\x03\x04`): the first bytes of every .osz. */
export const ZIP_HEAD = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * @function zip
 * @returns {Uint8Array<ArrayBuffer>} the zip signature plus four bytes: enough for the client's check
 */
export const zip = (): Uint8Array<ArrayBuffer> => Uint8Array.from([...ZIP_HEAD, 0, 0, 0, 0]);

/**
 * @function stub
 * @param route {Route} answers each request
 * @param options {Omit<HinaiClientOptions, "fetch">} the other client options
 * @returns {{ client, calls }} a client on the stub fetch, and every call it made
 */
export const stub = (route: Route, options: Omit<HinaiClientOptions, "fetch"> = {}) => {
  const calls: Call[] = [];
  const client = createHinaiClient({
    ...options,
    fetch: async (input, init) => {
      calls.push({ url: String(input), init, headers: new Headers(init?.headers) });
      return route(String(input), init);
    },
  });
  return { client, calls };
};

/**
 * @function failure
 * @param promise {Promise<unknown>} a call expected to reject
 * @returns {Promise<unknown>} what it rejected with, or null when it resolved
 */
export const failure = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => null,
    (error: unknown) => error,
  );

/** A fetch that never answers; it rejects with the signal's reason on abort, as fetch does. */
export const hang: Route = (_url, init) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

/**
 * @function stalled
 * @param init {RequestInit | undefined} with it, the body errors when the request's signal aborts,
 *        as fetch's bodies do; without, only the client can stop it
 * @param first {Uint8Array | undefined} a chunk to send before stalling
 * @returns {{ body, state }} the body, and `state.cancelled` (whether the client released it)
 */
export const stalled = (init?: RequestInit, first?: Uint8Array) => {
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
