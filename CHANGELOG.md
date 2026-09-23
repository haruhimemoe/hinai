# Changelog

All notable changes to `@haruhimemoe/hinai`.

## 0.1.0 (unreleased)

- First release, extracted from packs.haruhime.moe's hinai client and downloader.
- `createHinaiClient({ baseUrl?, fetch?, userAgent?, timeoutMs? })` with `getBeatmaps`, `getAvailability` and `downloadSet`; `setDownloadUrl`, `OSZ_MIME`, `HINAI_TIMEOUT_MS`, `HinaiError`, `parseRetryAfter`, `backoffDelayMs`.
- Changes from packs:
  - One client instead of `createHinaiClient` plus `createHinaiDownloader`.
  - An optional `userAgent` for servers.
  - Beatmap shapes come from `@haruhimemoe/osu/shapes`.
  - No shared default instances.
- Hardening before release (from review):
  - New export `HINAI_TIMEOUT_MS` (10 s) and a `timeoutMs` option. Metadata and availability requests are timed end to end; downloads only until the headers arrive. A timeout is a retryable `HinaiError` with code `timeout`.
  - `getBeatmaps(ids, { signal })`. An abort rejects with the signal's reason wherever it lands, including while a body is read (it used to surface as `bad_response` or `http_error`).
  - Metadata errors are read like download errors: `response.ok` is checked before parsing, 429 is retryable, `Retry-After` is kept, and a 404 is `not_found`. An HTML error page is `http_error` (retryable only on 429 and 5xx), no longer a retryable `bad_response`; the ported test for a 502 HTML page now expects `http_error`.
  - `HinaiError` gains `requestId` (from `x-hinai-request-id`) and `hint` (from the mirror's error body), both null when absent.
  - `baseUrl` must be an absolute http(s) URL (`RangeError` otherwise) and loses trailing slashes. Set ids that aren't positive safe integers throw `RangeError` before any request; `getBeatmaps` never sends such ids and returns them in `missing`.
  - The zip signature is checked on the first bytes, so a non-zip body stops early. Unread bodies are released. An error thrown by `onProgress` passes through untouched.
  - `userAgent` is ignored in a browser.
  - Option types accept an explicit `undefined` under `exactOptionalPropertyTypes`, and `BeatmapOptions` is exported.
- Needs `@haruhimemoe/osu` 0.1 on npm first.
