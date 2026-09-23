/**
 * @file src/client.ts
 * @desc Client for the hinai beatmap mirror (mirror.hinamizawa.ai): difficulty metadata in
 *       osu!'s shape (mapped to BeatmapMeta), a set's availability, and streamed .osz downloads
 *       with progress, abort, and a zip-signature check. No auth; CORS is open, so it runs in
 *       browsers, which send no custom headers (no preflight). On a server, pass userAgent.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Wed Sep 23, 2026
 */

import { type BeatmapMeta, osuBeatmapRowSchema, toBeatmapMeta } from "@haruhimemoe/osu/shapes";
import { HinaiError } from "./errors.js";
import { parseRetryAfter } from "./retry.js";
import { hinaiAvailabilitySchema, hinaiErrorSchema } from "./schemas.js";

export const HINAI_BASE_URL = "https://mirror.hinamizawa.ai";
/** The mirror answers at most this many ids per metadata call. */
export const HINAI_BATCH_LIMIT = 100;

export type BeatmapLookup = { found: Map<number, BeatmapMeta>; missing: number[] };

export const OSZ_MIME = "application/x-osu-beatmap-archive";

export type SetAvailability = { downloadable: boolean; reason: string | null };
export type DownloadProgress = { loaded: number; total: number | null };
export type DownloadOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
  /** Ask for the archive with its video. Default: without. */
  video?: boolean;
};

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const NETWORK_MESSAGE = "Couldn't reach the beatmap mirror. Check your connection and try again.";
const UNREADABLE_MESSAGE = "The beatmap mirror sent a response we couldn't read.";

/**
 * @function setDownloadUrl
 * @param setId {number} beatmapset id
 * @param baseUrl {string} mirror origin
 * @param video {boolean} true for the archive with its video
 * @returns {string} the .osz URL (no-video unless asked)
 */
export const setDownloadUrl = (
  setId: number,
  baseUrl: string = HINAI_BASE_URL,
  video = false,
): string => `${baseUrl}/api/v1/hinai/d/${setId}${video ? "" : "?noVideo=true"}`;

const errorFor = async (response: Response, notFound: string): Promise<HinaiError> => {
  const { status } = response;
  if (status === 404) return new HinaiError("not_found", notFound, { status });
  const retryable = status === 429 || status >= 500;
  const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"), Date.now());
  const parsed = hinaiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success
    ? new HinaiError(parsed.data.code, parsed.data.error, {
        status,
        retryable: parsed.data.retryable ?? retryable,
        retryAfterMs,
      })
    : new HinaiError("http_error", `The beatmap mirror answered ${status}.`, {
        status,
        retryable,
        retryAfterMs,
      });
};

const isZip = async (blob: Blob): Promise<boolean> => {
  const head = new Uint8Array(await blob.slice(0, ZIP_MAGIC.length).arrayBuffer());
  return ZIP_MAGIC.every((byte, i) => head[i] === byte);
};

export type HinaiClientOptions = {
  /** Default https://mirror.hinamizawa.ai. */
  baseUrl?: string;
  fetch?: (input: string | URL, init?: RequestInit) => Promise<Response>;
  /**
   * Sent as User-Agent on every request, as the mirror asks. Servers only: browsers don't let
   * pages set it, so leave it out there.
   */
  userAgent?: string;
};

/**
 * @function createHinaiClient
 * @param options {HinaiClientOptions} base URL, fetch, and (on servers) a User-Agent
 * @returns {{ getBeatmaps, getAvailability, downloadSet }} the client
 */
export const createHinaiClient = (options: HinaiClientOptions = {}) => {
  const baseUrl = options.baseUrl ?? HINAI_BASE_URL;
  // Resolve globalThis.fetch per call so test interceptors installed later still apply.
  const doFetch =
    options.fetch ?? ((input: string | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const headers: Record<string, string> | undefined = options.userAgent
    ? { "User-Agent": options.userAgent }
    : undefined;
  const send = (url: string, signal?: AbortSignal) =>
    doFetch(url, {
      ...(signal ? { signal } : {}),
      ...(headers ? { headers } : {}),
    });

  const fetchBatch = async (ids: readonly number[]): Promise<unknown[]> => {
    let response: Response;
    try {
      response = await send(`${baseUrl}/api/v2/beatmaps?ids=${ids.join(",")}`);
    } catch (cause) {
      throw new HinaiError(
        "network",
        "Couldn't reach the beatmap mirror. Check your connection and try again.",
        { retryable: true, cause },
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new HinaiError("bad_response", "The beatmap mirror sent a response we couldn't read.", {
        status: response.status,
        retryable: true,
        cause,
      });
    }

    if (!response.ok) {
      const parsed = hinaiErrorSchema.safeParse(body);
      throw parsed.success
        ? new HinaiError(parsed.data.code, parsed.data.error, {
            status: response.status,
            retryable: parsed.data.retryable ?? response.status >= 500,
          })
        : new HinaiError("http_error", `The beatmap mirror answered ${response.status}.`, {
            status: response.status,
            retryable: response.status >= 500,
          });
    }

    if (!Array.isArray(body)) {
      throw new HinaiError("bad_response", "The beatmap mirror sent a response we couldn't read.", {
        status: response.status,
        retryable: true,
      });
    }
    return body;
  };

  const request = async (url: string, signal?: AbortSignal): Promise<Response> => {
    try {
      return await send(url, signal);
    } catch (cause) {
      if (signal?.aborted) throw signal.reason;
      throw new HinaiError("network", NETWORK_MESSAGE, { retryable: true, cause });
    }
  };

  return {
    /**
     * @function getBeatmaps
     * @param ids {readonly number[]} difficulty ids (duplicates fine)
     * @returns {Promise<BeatmapLookup>} metadata for every id the mirror knows; the rest in missing
     * @throws {HinaiError} on network failure, an unreadable response, or an error status
     */
    async getBeatmaps(ids: readonly number[]): Promise<BeatmapLookup> {
      const unique = [...new Set(ids)];
      const wanted = new Set(unique);
      const found = new Map<number, BeatmapMeta>();
      for (let i = 0; i < unique.length; i += HINAI_BATCH_LIMIT) {
        for (const row of await fetchBatch(unique.slice(i, i + HINAI_BATCH_LIMIT))) {
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
     * @param signal {AbortSignal} cancels the request
     * @returns {Promise<SetAvailability>} downloadable unless the mirror says download_disabled
     * @throws {HinaiError} not_found, bad_response, network, or the mirror's own code
     */
    async getAvailability(setId: number, signal?: AbortSignal): Promise<SetAvailability> {
      const response = await request(`${baseUrl}/api/s/${setId}/availability`, signal);
      if (!response.ok) throw await errorFor(response, "This beatmapset isn't on the mirror.");
      const parsed = hinaiAvailabilitySchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) {
        throw new HinaiError("bad_response", UNREADABLE_MESSAGE, {
          status: response.status,
          retryable: true,
        });
      }
      const { download_disabled, more_information } = parsed.data.availability;
      return { downloadable: download_disabled !== true, reason: more_information };
    },

    /**
     * @function downloadSet
     * @param setId {number} beatmapset id
     * @param options {DownloadOptions} abort signal, progress callback, video
     * @returns {Promise<Blob>} the .osz (checked to start with the zip signature)
     * @throws {HinaiError} on any failure except an abort, which rejects with the signal's reason
     */
    async downloadSet(
      setId: number,
      { signal, onProgress, video = false }: DownloadOptions = {},
    ): Promise<Blob> {
      const response = await request(setDownloadUrl(setId, baseUrl, video), signal);
      if (!response.ok) throw await errorFor(response, "The mirror doesn't have this beatmapset.");

      const total = Number(response.headers.get("content-length")) || null;
      const chunks: BlobPart[] = [];
      let loaded = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            loaded += value.byteLength;
            onProgress?.({ loaded, total });
          }
        } catch (cause) {
          if (signal?.aborted) throw signal.reason;
          throw new HinaiError("network", "The download was interrupted. Try again.", {
            retryable: true,
            cause,
          });
        }
      }

      const blob = new Blob(chunks, { type: OSZ_MIME });
      if (!(await isZip(blob))) {
        throw new HinaiError(
          "bad_response",
          "The mirror sent something that isn't a beatmap archive.",
          {
            status: response.status,
            retryable: true,
          },
        );
      }
      return blob;
    },
  };
};

export type HinaiClient = ReturnType<typeof createHinaiClient>;
