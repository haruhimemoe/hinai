/**
 * @file src/errors.ts
 * @desc HinaiError: every failure the mirror client reports, with a code to branch on, the HTTP
 *       status, whether trying again can help, and the mirror's Retry-After.
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

  constructor(
    code: string,
    message: string,
    options: {
      status?: number | null;
      retryable?: boolean;
      retryAfterMs?: number | null;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "HinaiError";
    this.code = code;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}
