# Changelog

All notable changes to `@haruhimemoe/hinai` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-09-28

### Added

- `@haruhimemoe/hinai/testing`: msw handlers that answer like the mirror (`hinaiHandlers`, `hinaiBatchHandler`, `hinaiDownloadHandlers`, `hinaiUnknownSetHandler`), the endpoint paths, the answers recorded from the mirror (`recordedBeatmaps`, `recordedAvailability`, `recordedUnknownSet`) and `fakeOsz(setId)`. Apps can mock the mirror with what this package tests itself with, instead of copies that drift. `msw` ^2.0.0 is an optional peer dependency, needed only for this entry.

### Fixed

- `createHinaiClient` throws a `RangeError` for a `userAgent` that isn't a valid header value (an emoji or a line break, say). Before, every request failed as a retryable `network` error.
- `createHinaiClient` and `setDownloadUrl` refuse a `baseUrl` with a query, hash or credentials with a `RangeError`. Before, they built broken request URLs, or every request failed as a retryable `network` error.
- A signal that's already aborted rejects every method at once, before any request. Before, `getBeatmaps` resolved when it had nothing to send (an empty list, or no valid id).

### Security

- `setDownloadUrl` checks `baseUrl` like `createHinaiClient` does. Before, `setDownloadUrl(1, "javascript:alert(1)//")` returned a `javascript:` URL.
- `forensicsUrl` is `null` unless the mirror's `x-hinai-forensics` header is an absolute http(s) URL, so a `javascript:` value can't reach an app's link.

## [0.2.0] - 2026-09-25

### Changed

- Depends on `@haruhimemoe/osu` 0.2.0. If your app imports `@haruhimemoe/osu` directly, move it to 0.2.x.

### Fixed

- A download that breaks off mid-stream, and a timeout while a response body is read, now keep the response's `requestId` and `forensicsUrl` instead of `null`.
- `parseRetryAfter` returns `null` for a value that is neither delta-seconds nor an IMF-fixdate HTTP date. Before, values like `1.5`, `-5` or an ISO date were read as past dates and gave 0, so `backoffDelayMs` retried at once.

## [0.1.0] - 2026-09-23

### Added

- `createHinaiClient` for the [hinai beatmap mirror](https://mirror.hinamizawa.ai), in browsers and on servers: `getBeatmaps` (as `BeatmapMeta` from `@haruhimemoe/osu/shapes`), `getAvailability` and `downloadSet`, streamed with progress, abort and a zip signature check.
- `HinaiError` with a `code`, `retryable`, `retryAfterMs`, the mirror's `hint`, `requestId` and `forensicsUrl`.
- `backoffDelayMs` and `parseRetryAfter` for retry loops.

[unreleased]: https://github.com/haruhimemoe/hinai/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/haruhimemoe/hinai/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/haruhimemoe/hinai/compare/07a38ad40f9bb652940badf2fc456877c1443b56...v0.2.0
[0.1.0]: https://github.com/haruhimemoe/hinai/tree/07a38ad40f9bb652940badf2fc456877c1443b56
