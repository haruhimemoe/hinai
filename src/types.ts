/**
 * @file src/types.ts
 * @desc The client's public option and result types: what createHinaiClient and its three
 *       methods take and resolve to.
 * @author David @dvhsh (https://dvh.sh)
 * @created Mon Sep 28, 2026
 * @modified Mon Sep 28, 2026
 */

import type { BeatmapMeta } from "@haruhimemoe/osu/shapes";

/**
 * Result of getBeatmaps: metadata by difficulty id (only ids that were sent and parsed), and every
 * other id passed in, once each, in input order.
 */
export type BeatmapLookup = { found: Map<number, BeatmapMeta>; missing: number[] };

/** Options for getBeatmaps. */
export type BeatmapOptions = {
  /** Cancels the lookup; it then rejects with the signal's reason. */
  signal?: AbortSignal | undefined;
};

/**
 * Result of getAvailability: downloadable unless the mirror says downloads are disabled, and the
 * mirror's reason (more_information), or null.
 */
export type SetAvailability = { downloadable: boolean; reason: string | null };

/** Options for getAvailability. */
export type AvailabilityOptions = {
  /** Cancels the request; it then rejects with the signal's reason. */
  signal?: AbortSignal | undefined;
};

/**
 * What onProgress gets per chunk: bytes read so far, and the content-length, or null when the
 * mirror sent none or the body turned out longer than it said.
 */
export type DownloadProgress = { loaded: number; total: number | null };

/** Options for downloadSet. */
export type DownloadOptions = {
  /** Cancels the download at any point; it then rejects with the signal's reason. */
  signal?: AbortSignal | undefined;
  /** Called per chunk once the archive is known to be a zip. What it throws rejects the call. */
  onProgress?: ((progress: DownloadProgress) => void) | undefined;
  /** Ask for the archive with its video. Default: without. */
  video?: boolean | undefined;
};

/** Options for createHinaiClient. Each also takes undefined, meaning "use the default". */
export type HinaiClientOptions = {
  /**
   * Default https://mirror.hinamizawa.ai. Must be an absolute http(s) URL with no query, hash or
   * credentials.
   */
  baseUrl?: string | undefined;
  /** Used for every request. Default: globalThis.fetch, looked up per request. */
  fetch?: ((input: string | URL, init?: RequestInit) => Promise<Response>) | undefined;
  /**
   * Sent as User-Agent on every request, as the mirror asks. Servers only: in a browser (where
   * `document` exists) or a worker (`self` with no `window`, and `importScripts`) it's ignored,
   * since pages and workers can't set it and extra headers force a preflight. Must be a valid
   * header value (no line breaks or characters outside Latin-1).
   */
  userAgent?: string | undefined;
  /**
   * How long a metadata or availability request may take, body included, and how long a download
   * may wait for its headers (the body then streams with no limit but your signal). Default
   * HINAI_TIMEOUT_MS (10 s). Must be an integer from 1 to 2147483647 (2^31 - 1): `setTimeout`
   * overflows and gets clamped to ~1 ms beyond that, which would time out almost immediately.
   */
  timeoutMs?: number | undefined;
};
