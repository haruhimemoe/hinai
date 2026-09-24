# Changelog

All notable changes to `@haruhimemoe/hinai` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- A download that breaks off mid-stream, and a timeout while a response body is read, now keep the response's `requestId` and `forensicsUrl` instead of `null`.
- `parseRetryAfter` returns `null` for a value that is neither delta-seconds nor an IMF-fixdate HTTP date. Before, values like `1.5`, `-5` or an ISO date were read as past dates and gave 0, so `backoffDelayMs` retried at once.

## [0.1.0] - 2026-09-23

### Added

- `createHinaiClient` for the [hinai beatmap mirror](https://mirror.hinamizawa.ai), in browsers and on servers: `getBeatmaps` (as `BeatmapMeta` from `@haruhimemoe/osu/shapes`), `getAvailability` and `downloadSet`, streamed with progress, abort and a zip signature check.
- `HinaiError` with a `code`, `retryable`, `retryAfterMs`, the mirror's `hint`, `requestId` and `forensicsUrl`.
- `backoffDelayMs` and `parseRetryAfter` for retry loops.

[unreleased]: https://github.com/haruhimemoe/hinai/compare/07a38ad40f9bb652940badf2fc456877c1443b56...HEAD
[0.1.0]: https://github.com/haruhimemoe/hinai/tree/07a38ad40f9bb652940badf2fc456877c1443b56
