/**
 * @file src/archive.ts
 * @desc Reading a download's body into an .osz Blob: chunk by chunk with progress and abort, and a
 *       zip-signature check on the first bytes before any progress is reported.
 * @author David @dvhsh (https://dvh.sh)
 * @created Mon Sep 28, 2026
 * @modified Mon Sep 28, 2026
 */

import { HinaiError } from "./errors.js";
import { responseIds } from "./response.js";
import type { DownloadOptions } from "./types.js";

/** MIME type of the Blob downloadSet resolves to. */
export const OSZ_MIME = "application/x-osu-beatmap-archive";

/** The zip signature (`PK\x03\x04`) every .osz starts with. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const NOT_ZIP_MESSAGE = "The mirror sent something that isn't a beatmap archive.";
const INTERRUPTED_MESSAGE = "The download was interrupted. Try again.";

/**
 * @function readArchive
 * @param response {Response} the download's OK response
 * @param signal {AbortSignal | undefined} the caller's signal
 * @param onProgress {DownloadOptions["onProgress"]} called per chunk after the zip check
 * @returns {Promise<Blob>} the whole archive, typed OSZ_MIME
 * @throws {HinaiError} bad_response when the body isn't a zip, network when it breaks off; an
 *         abort rejects with the signal's reason, and what onProgress throws passes through
 */
export const readArchive = async (
  response: Response,
  signal: AbortSignal | undefined,
  onProgress: DownloadOptions["onProgress"],
): Promise<Blob> => {
  const ids = responseIds(response);
  const notZip = () =>
    new HinaiError("bad_response", NOT_ZIP_MESSAGE, {
      status: response.status,
      retryable: true,
      ...ids,
    });
  if (!response.body) throw notZip();
  let total = Number(response.headers.get("content-length")) || null;
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
        throw new HinaiError("network", INTERRUPTED_MESSAGE, { retryable: true, ...ids, cause });
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
      // A compressing proxy can report an encoded content-length shorter than the decoded body.
      if (total !== null && loaded > total) total = null;
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
