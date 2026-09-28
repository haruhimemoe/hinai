/**
 * @file src/response.ts
 * @desc Reading the mirror's responses: the request id and forensics URL every HinaiError keeps,
 *       JSON bodies (aborts and timeouts rethrown as such), and the HinaiError for an error status
 *       or a body that can't be read. Internal, not exported from the package.
 * @author David @dvhsh (https://dvh.sh)
 * @created Mon Sep 28, 2026
 * @modified Mon Sep 28, 2026
 */

import { HinaiError } from "./errors.js";
import { parseRetryAfter } from "./retry.js";
import { hinaiErrorSchema } from "./schemas.js";

/** One request's signals: the caller's, plus a deadline that can be stopped. */
export type Attempt = {
  signal: AbortSignal;
  /** Stops the deadline (a download, once its body starts). */
  stop: () => void;
  /**
   * Throws what an abort or timeout means (the caller's reason, or a timeout carrying the ids of
   * `response`, when there is one); else returns.
   */
  settle: (cause: unknown, response?: Response) => void;
};

/** The ids a HinaiError quotes for a response. */
export type ResponseIds = { requestId: string | null; forensicsUrl: string | null };

type JsonRead = { ok: true; body: unknown } | { ok: false; cause: unknown };

const UNREADABLE_MESSAGE = "The beatmap mirror sent a response we couldn't read.";

/**
 * @function responseIds
 * @param response {Response | undefined} the mirror's response, when one arrived
 * @returns {ResponseIds} its x-hinai-request-id and x-hinai-forensics headers, else nulls
 */
export const responseIds = (response?: Response): ResponseIds => ({
  requestId: response?.headers.get("x-hinai-request-id") ?? null,
  forensicsUrl: response?.headers.get("x-hinai-forensics") ?? null,
});

/**
 * @function readJson
 * @param response {Response} a response whose body should be JSON
 * @param attempt {Attempt} the request's signals
 * @returns {Promise<JsonRead>} the body, or why it couldn't be read
 * @throws the caller's abort reason, or a timeout HinaiError, when either cut the read short
 */
export const readJson = async (response: Response, attempt: Attempt): Promise<JsonRead> => {
  try {
    return { ok: true, body: await response.json() };
  } catch (cause) {
    attempt.settle(cause, response);
    return { ok: false, cause };
  }
};

/**
 * @function unreadable
 * @param response {Response} a success response whose body isn't what it should be
 * @param cause {unknown} why (a JSON or schema error), when known
 * @returns {HinaiError} a retryable bad_response
 */
export const unreadable = (response: Response, cause?: unknown): HinaiError =>
  new HinaiError("bad_response", UNREADABLE_MESSAGE, {
    status: response.status,
    retryable: true,
    ...responseIds(response),
    cause,
  });

/**
 * @function errorFor
 * @param response {Response} a non-OK response
 * @param attempt {Attempt} the request's signals (reading the error body is still timed)
 * @param notFound {string} the message for a 404
 * @returns {Promise<HinaiError>} not_found (never retryable, with the mirror's hint when its body
 *          parses) for a 404; else the mirror's code, error and hint when its body has them; else
 *          http_error. 429 and 5xx are retryable unless the mirror says otherwise.
 * @throws the caller's abort reason, or a timeout HinaiError, while the body is read
 */
export const errorFor = async (
  response: Response,
  attempt: Attempt,
  notFound: string,
): Promise<HinaiError> => {
  const { status } = response;
  const ids = responseIds(response);
  const retryable = status === 429 || status >= 500;
  const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"), Date.now());
  const read = await readJson(response, attempt);
  const parsed = hinaiErrorSchema.safeParse(read.ok ? read.body : null);
  if (status === 404) {
    const hint = parsed.success ? (parsed.data.hint ?? null) : null;
    return new HinaiError("not_found", notFound, { status, ...ids, hint });
  }
  return parsed.success
    ? new HinaiError(parsed.data.code, parsed.data.error, {
        status,
        retryable: parsed.data.retryable ?? retryable,
        retryAfterMs,
        ...ids,
        hint: parsed.data.hint,
      })
    : new HinaiError("http_error", `The beatmap mirror answered ${status}.`, {
        status,
        retryable,
        retryAfterMs,
        ...ids,
      });
};
