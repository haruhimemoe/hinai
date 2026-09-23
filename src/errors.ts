/**
 * @file src/errors.ts
 * @desc HinaiError: every failure the mirror client reports, with a code to branch on, the HTTP
 *       status, whether trying again can help, the mirror's Retry-After, its hint, and the
 *       request id to quote when reporting a problem.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Wed Sep 23, 2026
 */

export class HinaiError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly retryable: boolean;
  /** How long the mirror asked us to wait (Retry-After), when it said. */
  readonly retryAfterMs: number | null;
  /**
   * The mirror's x-hinai-request-id for this response, when it sent one. Quote it when reporting a
   * problem. A browser only sees it when the mirror exposes the header to CORS.
   */
  readonly requestId: string | null;
  /** The mirror's hint from its error body (what it would accept instead), when it gave one. */
  readonly hint: string | null;

  constructor(
    code: string,
    message: string,
    options: {
      status?: number | null | undefined;
      retryable?: boolean | undefined;
      retryAfterMs?: number | null | undefined;
      requestId?: string | null | undefined;
      hint?: string | null | undefined;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "HinaiError";
    this.code = code;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.requestId = options.requestId ?? null;
    this.hint = options.hint ?? null;
  }
}
