/**
 * @file src/client.ts
 * @desc Client for the hinai beatmap mirror (mirror.hinamizawa.ai): difficulty metadata in
 *       osu!'s shape (mapped to BeatmapMeta), a set's availability, and streamed .osz downloads.
 *       No auth; CORS is open, so it runs in browsers and workers, which send no custom headers
 *       (no preflight). On a server, pass userAgent. Metadata and availability requests give up
 *       after timeoutMs; downloads only wait that long for the headers, then stream for as long
 *       as the caller's signal allows.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Mon Sep 28, 2026
 */

import { type BeatmapMeta, osuBeatmapRowSchema, toBeatmapMeta } from "@haruhimemoe/osu/shapes";
import type { z } from "zod";
import { readArchive } from "./archive.js";
import { HinaiError } from "./errors.js";
import { type Attempt, errorFor, readJson, responseIds, unreadable } from "./response.js";
import { hinaiAvailabilitySchema, hinaiBatchSchema } from "./schemas.js";
import type {
  AvailabilityOptions,
  BeatmapLookup,
  BeatmapOptions,
  DownloadOptions,
  HinaiClientOptions,
  SetAvailability,
} from "./types.js";

/** Default baseUrl: the public hinai mirror. */
export const HINAI_BASE_URL = "https://mirror.hinamizawa.ai";
/** The mirror answers at most this many ids per metadata call. */
export const HINAI_BATCH_LIMIT = 100;
/** Default time a metadata or availability request, or a download's headers, may take. */
export const HINAI_TIMEOUT_MS = 10_000;

/** setTimeout's ms limit (2^31 - 1); beyond this Node and browsers clamp to ~1 ms. */
const MAX_TIMEOUT_MS = 2_147_483_647;
const NETWORK_MESSAGE = "Couldn't reach the beatmap mirror. Check your connection and try again.";

const isId = (id: number): boolean => Number.isSafeInteger(id) && id > 0;
const checkSetId = (setId: number): void => {
  if (!isId(setId)) throw new RangeError("setId must be a positive integer.");
};

/**
 * The base URL without trailing slashes. Paths are appended to it as text, so a query, hash or
 * credentials (which fetch refuses) would break every request: refuse them up front.
 */
const checkBaseUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const url = URL.canParse(trimmed) ? new URL(trimmed) : null;
  if (
    (url?.protocol !== "https:" && url?.protocol !== "http:") ||
    /[?#]/.test(trimmed) ||
    url.username ||
    url.password
  ) {
    throw new RangeError("baseUrl must be an absolute http(s) URL, with no query, hash or login.");
  }
  return trimmed;
};

/**
 * @function setDownloadUrl
 * @param setId {number} beatmapset id
 * @param baseUrl {string} mirror origin
 * @param video {boolean} true for the archive with its video
 * @returns {string} the .osz URL (no-video unless asked)
 * @throws {RangeError} when setId isn't a positive integer, or baseUrl isn't an absolute http(s)
 *         URL with no query, hash or credentials
 */
export const setDownloadUrl = (
  setId: number,
  baseUrl: string = HINAI_BASE_URL,
  video = false,
): string => {
  checkSetId(setId);
  return `${checkBaseUrl(baseUrl)}/api/v1/hinai/d/${setId}${video ? "" : "?noVideo=true"}`;
};

/**
 * The User-Agent header to send, if any: only on servers (see HinaiClientOptions.userAgent), and
 * only a value fetch will take, so a bad one fails here rather than as a retryable network error
 * on every request.
 */
const userAgentHeaders = (userAgent: string | undefined): Record<string, string> | undefined => {
  // Workers have no `document` either, and a non-safelisted header there forces a preflight too.
  const inBrowser =
    typeof document !== "undefined" ||
    (typeof self !== "undefined" && typeof window === "undefined" && "importScripts" in self);
  if (!userAgent || inBrowser) return undefined;
  try {
    new Headers({ "User-Agent": userAgent });
  } catch (cause) {
    throw new RangeError("userAgent must be a valid header value.", { cause });
  }
  return { "User-Agent": userAgent };
};

/**
 * @function createHinaiClient
 * @param options {HinaiClientOptions} base URL, fetch, timeout, and (on servers) a User-Agent
 * @returns {{ getBeatmaps, getAvailability, downloadSet }} the client
 * @throws {RangeError} when baseUrl isn't an absolute http(s) URL with no query, hash or
 *         credentials, timeoutMs isn't an integer from 1 to 2147483647, or userAgent (on a
 *         server) isn't a valid header value
 */
export const createHinaiClient = (options: HinaiClientOptions = {}) => {
  const baseUrl = checkBaseUrl(options.baseUrl ?? HINAI_BASE_URL);
  const timeoutMs = options.timeoutMs ?? HINAI_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new RangeError(`timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}.`);
  }
  // Resolve globalThis.fetch per call so test interceptors installed later still apply.
  const doFetch =
    options.fetch ?? ((input: string | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const headers = userAgentHeaders(options.userAgent);

  /** Starts a request's deadline, joined with the caller's signal. */
  const begin = (signal: AbortSignal | undefined): Attempt => {
    const deadline = new AbortController();
    const timer = setTimeout(
      () => deadline.abort(new DOMException("The mirror didn't answer in time.", "TimeoutError")),
      timeoutMs,
    );
    return {
      signal: signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal,
      stop: () => clearTimeout(timer),
      settle(cause, response) {
        if (signal?.aborted) throw signal.reason;
        if (deadline.signal.aborted) {
          throw new HinaiError(
            "timeout",
            `The beatmap mirror didn't answer in time (${timeoutMs} ms). Try again.`,
            { retryable: true, ...responseIds(response), cause },
          );
        }
      },
    };
  };

  /** Sends a GET, turning a network failure into a HinaiError (aborts and timeouts aside). */
  const open = async (url: string, attempt: Attempt): Promise<Response> => {
    try {
      return await doFetch(url, { signal: attempt.signal, ...(headers ? { headers } : {}) });
    } catch (cause) {
      attempt.settle(cause);
      throw new HinaiError("network", NETWORK_MESSAGE, { retryable: true, cause });
    }
  };

  /** GETs a JSON body that must match `schema`, timed end to end, body included. */
  const getJson = async <T>(
    url: string,
    schema: z.ZodType<T>,
    signal: AbortSignal | undefined,
    notFound: string,
  ): Promise<T> => {
    const attempt = begin(signal);
    try {
      const response = await open(url, attempt);
      if (!response.ok) throw await errorFor(response, attempt, notFound);
      const read = await readJson(response, attempt);
      if (!read.ok) throw unreadable(response, read.cause);
      const parsed = schema.safeParse(read.body);
      if (!parsed.success) throw unreadable(response, parsed.error);
      return parsed.data;
    } finally {
      attempt.stop();
    }
  };

  return {
    /**
     * @function getBeatmaps
     * @param ids {readonly number[]} difficulty ids (duplicates fine; anything but a positive
     *        integer is never sent and comes back missing)
     * @param options {BeatmapOptions} an abort signal
     * @returns {Promise<BeatmapLookup>} metadata for every id the mirror knows; the rest in missing
     * @throws {HinaiError} on network failure, a timeout, an unreadable response, or an error
     *         status; an abort rejects with the signal's reason
     */
    async getBeatmaps(
      ids: readonly number[],
      { signal }: BeatmapOptions = {},
    ): Promise<BeatmapLookup> {
      // Even with nothing to send: an aborted lookup must not look finished.
      signal?.throwIfAborted();
      const unique = [...new Set(ids)];
      const valid = unique.filter(isId);
      const wanted = new Set(valid);
      const found = new Map<number, BeatmapMeta>();
      for (let i = 0; i < valid.length; i += HINAI_BATCH_LIMIT) {
        const batch = valid.slice(i, i + HINAI_BATCH_LIMIT);
        const rows = await getJson(
          `${baseUrl}/api/v2/beatmaps?ids=${batch.join(",")}`,
          hinaiBatchSchema,
          signal,
          "The beatmap mirror has no metadata lookup here.",
        );
        for (const row of rows) {
          const parsed = osuBeatmapRowSchema.safeParse(row);
          if (parsed.success && wanted.has(parsed.data.id)) {
            found.set(parsed.data.id, toBeatmapMeta(parsed.data));
          }
        }
      }
      return { found, missing: unique.filter((id) => !found.has(id)) };
    },

    /**
     * @function getAvailability
     * @param setId {number} beatmapset id
     * @param options {AvailabilityOptions} an abort signal
     * @returns {Promise<SetAvailability>} downloadable unless the mirror says download_disabled
     *          (an unknown answer, null, counts as downloadable)
     * @throws {HinaiError} not_found for a set the mirror doesn't know, bad_response, timeout,
     *         network, or the mirror's own code; an abort rejects with the signal's reason
     * @throws {RangeError} when setId isn't a positive integer
     */
    async getAvailability(
      setId: number,
      { signal }: AvailabilityOptions = {},
    ): Promise<SetAvailability> {
      checkSetId(setId);
      signal?.throwIfAborted();
      const { availability } = await getJson(
        `${baseUrl}/api/s/${setId}/availability`,
        hinaiAvailabilitySchema,
        signal,
        "This beatmapset isn't on the mirror.",
      );
      return {
        downloadable: availability.download_disabled !== true,
        reason: availability.more_information,
      };
    },

    /**
     * @function downloadSet
     * @param setId {number} beatmapset id
     * @param options {DownloadOptions} abort signal, progress callback, video
     * @returns {Promise<Blob>} the .osz (checked to start with the zip signature)
     * @throws {HinaiError} on any failure except an abort, which rejects with the signal's reason,
     *         and an error thrown by onProgress, which rejects the call as it is
     * @throws {RangeError} when setId isn't a positive integer
     */
    async downloadSet(
      setId: number,
      { signal, onProgress, video = false }: DownloadOptions = {},
    ): Promise<Blob> {
      const url = setDownloadUrl(setId, baseUrl, video);
      signal?.throwIfAborted();
      const attempt = begin(signal);
      let response: Response;
      try {
        response = await open(url, attempt);
        if (!response.ok) {
          throw await errorFor(response, attempt, "The mirror doesn't have this beatmapset.");
        }
      } finally {
        // Only the headers (and an error body) are timed: an archive streams as long as it takes.
        attempt.stop();
      }
      return readArchive(response, signal, onProgress);
    },
  };
};

/** The client createHinaiClient returns: getBeatmaps, getAvailability and downloadSet. */
export type HinaiClient = ReturnType<typeof createHinaiClient>;
