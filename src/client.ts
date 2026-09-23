/**
 * @file src/client.ts
 * @desc Client for the hinai beatmap mirror (mirror.hinamizawa.ai): difficulty metadata in
 *       osu!'s shape (mapped to BeatmapMeta), a set's availability, and streamed .osz downloads
 *       with progress, abort, and a zip-signature check on the first bytes. No auth; CORS is open,
 *       so it runs in browsers, which send no custom headers (no preflight). On a server, pass
 *       userAgent. Metadata and availability requests give up after timeoutMs; downloads only
 *       wait that long for the headers, then stream for as long as the caller's signal allows.
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
/** Default time a metadata or availability request, or a download's headers, may take. */
export const HINAI_TIMEOUT_MS = 10_000;

export type BeatmapLookup = { found: Map<number, BeatmapMeta>; missing: number[] };
export type BeatmapOptions = {
  /** Cancels the lookup; it then rejects with the signal's reason. */
  signal?: AbortSignal | undefined;
};

export const OSZ_MIME = "application/x-osu-beatmap-archive";

export type SetAvailability = { downloadable: boolean; reason: string | null };
export type DownloadProgress = { loaded: number; total: number | null };
export type DownloadOptions = {
  /** Cancels the download at any point; it then rejects with the signal's reason. */
  signal?: AbortSignal | undefined;
  /** Called per chunk once the archive is known to be a zip. What it throws rejects the call. */
  onProgress?: ((progress: DownloadProgress) => void) | undefined;
  /** Ask for the archive with its video. Default: without. */
  video?: boolean | undefined;
};

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const NETWORK_MESSAGE = "Couldn't reach the beatmap mirror. Check your connection and try again.";
const UNREADABLE_MESSAGE = "The beatmap mirror sent a response we couldn't read.";
const NOT_ZIP_MESSAGE = "The mirror sent something that isn't a beatmap archive.";

const isId = (id: number): boolean => Number.isSafeInteger(id) && id > 0;
const checkSetId = (setId: number): void => {
  if (!isId(setId)) throw new RangeError("setId must be a positive integer.");
};
const trimSlashes = (url: string): string => url.replace(/\/+$/, "");
/** Frees the connection behind an unread body. Not awaited: a cancel can hang on some stubs. */
const release = (response: Response): void => {
  response.body?.cancel().catch(() => undefined);
};
const requestIdOf = (response: Response): string | null =>
  response.headers.get("x-hinai-request-id");

/**
 * @function setDownloadUrl
 * @param setId {number} beatmapset id
 * @param baseUrl {string} mirror origin
 * @param video {boolean} true for the archive with its video
 * @returns {string} the .osz URL (no-video unless asked)
 * @throws {RangeError} when setId isn't a positive integer
 */
export const setDownloadUrl = (
  setId: number,
  baseUrl: string = HINAI_BASE_URL,
  video = false,
): string => {
  checkSetId(setId);
  return `${trimSlashes(baseUrl)}/api/v1/hinai/d/${setId}${video ? "" : "?noVideo=true"}`;
};

export type HinaiClientOptions = {
  /** Default https://mirror.hinamizawa.ai. Must be an absolute http(s) URL. */
  baseUrl?: string | undefined;
  fetch?: ((input: string | URL, init?: RequestInit) => Promise<Response>) | undefined;
  /**
   * Sent as User-Agent on every request, as the mirror asks. Servers only: in a browser (where
   * `document` exists) it's ignored, since pages can't set it and extra headers force a preflight.
   */
  userAgent?: string | undefined;
  /**
   * How long a metadata or availability request may take, body included, and how long a download
   * may wait for its headers (the body then streams with no limit but your signal). Default
   * HINAI_TIMEOUT_MS (10 s).
   */
  timeoutMs?: number | undefined;
};

/** One request's signals: the caller's, plus a deadline that can be stopped. */
type Attempt = {
  signal: AbortSignal;
  /** Stops the deadline (a download, once its body starts). */
  stop: () => void;
  /** Throws what an abort or timeout means (the caller's reason, or a timeout); else returns. */
  settle: (cause: unknown) => void;
};

type JsonRead = { ok: true; body: unknown } | { ok: false; cause: unknown };

/**
 * @function createHinaiClient
 * @param options {HinaiClientOptions} base URL, fetch, timeout, and (on servers) a User-Agent
 * @returns {{ getBeatmaps, getAvailability, downloadSet }} the client
 * @throws {RangeError} when baseUrl isn't an absolute http(s) URL, or timeoutMs isn't a positive
 *         number
 */
export const createHinaiClient = (options: HinaiClientOptions = {}) => {
  const baseUrl = trimSlashes(options.baseUrl ?? HINAI_BASE_URL);
  const protocol = URL.canParse(baseUrl) ? new URL(baseUrl).protocol : "";
  if (protocol !== "https:" && protocol !== "http:") {
    throw new RangeError("baseUrl must be an absolute http(s) URL.");
  }
  const timeoutMs = options.timeoutMs ?? HINAI_TIMEOUT_MS;
  if (!(timeoutMs > 0 && Number.isFinite(timeoutMs))) {
    throw new RangeError("timeoutMs must be a positive number.");
  }
  // Resolve globalThis.fetch per call so test interceptors installed later still apply.
  const doFetch =
    options.fetch ?? ((input: string | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const inBrowser = typeof document !== "undefined";
  const headers: Record<string, string> | undefined =
    options.userAgent && !inBrowser ? { "User-Agent": options.userAgent } : undefined;

  const begin = (signal: AbortSignal | undefined): Attempt => {
    const deadline = new AbortController();
    const timer = setTimeout(
      () => deadline.abort(new DOMException("The mirror didn't answer in time.", "TimeoutError")),
      timeoutMs,
    );
    return {
      signal: signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal,
      stop: () => clearTimeout(timer),
      settle(cause) {
        if (signal?.aborted) throw signal.reason;
        if (deadline.signal.aborted) {
          throw new HinaiError(
            "timeout",
            `The beatmap mirror didn't answer in time (${timeoutMs} ms). Try again.`,
            { retryable: true, cause },
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

  /** A body's JSON, or why it couldn't be read. Aborts and timeouts are thrown instead. */
  const readJson = async (response: Response, attempt: Attempt): Promise<JsonRead> => {
    try {
      return { ok: true, body: await response.json() };
    } catch (cause) {
      attempt.settle(cause);
      return { ok: false, cause };
    }
  };

  const unreadable = (response: Response, cause?: unknown): HinaiError =>
    new HinaiError("bad_response", UNREADABLE_MESSAGE, {
      status: response.status,
      retryable: true,
      requestId: requestIdOf(response),
      cause,
    });

  /**
   * The HinaiError for a non-OK response: not_found (with `notFound` as the message) for a 404,
   * else the mirror's code, error and hint when its body has them, else http_error. 429 and 5xx
   * are retryable unless the mirror says otherwise.
   */
  const errorFor = async (
    response: Response,
    attempt: Attempt,
    notFound: string,
  ): Promise<HinaiError> => {
    const { status } = response;
    const requestId = requestIdOf(response);
    if (status === 404) {
      release(response);
      return new HinaiError("not_found", notFound, { status, requestId });
    }
    const retryable = status === 429 || status >= 500;
    const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"), Date.now());
    const read = await readJson(response, attempt);
    const parsed = hinaiErrorSchema.safeParse(read.ok ? read.body : null);
    return parsed.success
      ? new HinaiError(parsed.data.code, parsed.data.error, {
          status,
          retryable: parsed.data.retryable ?? retryable,
          retryAfterMs,
          requestId,
          hint: parsed.data.hint,
        })
      : new HinaiError("http_error", `The beatmap mirror answered ${status}.`, {
          status,
          retryable,
          retryAfterMs,
          requestId,
        });
  };

  const fetchBatch = async (
    ids: readonly number[],
    signal: AbortSignal | undefined,
  ): Promise<unknown[]> => {
    const attempt = begin(signal);
    try {
      const response = await open(`${baseUrl}/api/v2/beatmaps?ids=${ids.join(",")}`, attempt);
      if (!response.ok) {
        throw await errorFor(response, attempt, "The beatmap mirror has no metadata lookup here.");
      }
      const read = await readJson(response, attempt);
      if (!read.ok) throw unreadable(response, read.cause);
      if (!Array.isArray(read.body)) throw unreadable(response);
      return read.body;
    } finally {
      attempt.stop();
    }
  };

  /** Reads a download to the end, checking the zip signature before reporting any progress. */
  const readArchive = async (
    response: Response,
    signal: AbortSignal | undefined,
    onProgress: DownloadOptions["onProgress"],
  ): Promise<Blob> => {
    const notZip = () =>
      new HinaiError("bad_response", NOT_ZIP_MESSAGE, {
        status: response.status,
        retryable: true,
        requestId: requestIdOf(response),
      });
    if (!response.body) throw notZip();
    const total = Number(response.headers.get("content-length")) || null;
    const reader = response.body.getReader();
    const stop = () => {
      reader.cancel().catch(() => undefined);
    };
    // Cut the read short on abort even when fetch doesn't end the body itself.
    signal?.addEventListener("abort", stop, { once: true });
    const chunks: BlobPart[] = [];
    const head: number[] = [];
    let loaded = 0;
    try {
      for (;;) {
        let chunk: Awaited<ReturnType<typeof reader.read>>;
        try {
          chunk = await reader.read();
        } catch (cause) {
          signal?.throwIfAborted();
          throw new HinaiError("network", "The download was interrupted. Try again.", {
            retryable: true,
            cause,
          });
        }
        signal?.throwIfAborted();
        if (chunk.done) break;
        chunks.push(chunk.value);
        loaded += chunk.value.byteLength;
        if (head.length < ZIP_MAGIC.length) {
          head.push(...chunk.value.subarray(0, ZIP_MAGIC.length - head.length));
          if (head.length < ZIP_MAGIC.length) continue;
          if (!ZIP_MAGIC.every((byte, i) => head[i] === byte)) throw notZip();
        }
        onProgress?.({ loaded, total });
      }
    } catch (error) {
      stop();
      throw error;
    } finally {
      signal?.removeEventListener("abort", stop);
    }
    if (head.length < ZIP_MAGIC.length) throw notZip();
    return new Blob(chunks, { type: OSZ_MIME });
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
      const unique = [...new Set(ids)];
      const valid = unique.filter(isId);
      const wanted = new Set(valid);
      const found = new Map<number, BeatmapMeta>();
      for (let i = 0; i < valid.length; i += HINAI_BATCH_LIMIT) {
        for (const row of await fetchBatch(valid.slice(i, i + HINAI_BATCH_LIMIT), signal)) {
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
     *          (an unknown answer, null, counts as downloadable)
     * @throws {HinaiError} not_found for a set the mirror doesn't know, bad_response, timeout,
     *         network, or the mirror's own code; an abort rejects with the signal's reason
     * @throws {RangeError} when setId isn't a positive integer
     */
    async getAvailability(
      setId: number,
      signal?: AbortSignal | undefined,
    ): Promise<SetAvailability> {
      checkSetId(setId);
      const attempt = begin(signal);
      try {
        const response = await open(`${baseUrl}/api/s/${setId}/availability`, attempt);
        if (!response.ok) {
          throw await errorFor(response, attempt, "This beatmapset isn't on the mirror.");
        }
        const read = await readJson(response, attempt);
        if (!read.ok) throw unreadable(response, read.cause);
        const parsed = hinaiAvailabilitySchema.safeParse(read.body);
        if (!parsed.success) throw unreadable(response, parsed.error);
        const { download_disabled, more_information } = parsed.data.availability;
        return { downloadable: download_disabled !== true, reason: more_information };
      } finally {
        attempt.stop();
      }
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

export type HinaiClient = ReturnType<typeof createHinaiClient>;
