# AGENTS.md

`@haruhimemoe/hinai`: a client for the hinai beatmap mirror (mirror.hinamizawa.ai). Difficulty metadata (as `BeatmapMeta` from `@haruhimemoe/osu/shapes`), set availability, and `.osz` downloads. One npm package with one entry point; runs in browsers, workers and on servers.

## Layout

- `src/index.ts`: the entry point. Re-exports `client.ts`, `errors.ts`, `retry.ts`, the types in `types.ts` and `OSZ_MIME` from `archive.ts`.
- `src/client.ts`: `createHinaiClient` (`getBeatmaps`, `getAvailability`, `downloadSet`), `setDownloadUrl`, the constants (`HINAI_BASE_URL`, `HINAI_BATCH_LIMIT`, `HINAI_TIMEOUT_MS`) and `HinaiClient`.
- `src/types.ts`: the option and result types (`HinaiClientOptions`, `BeatmapLookup`, `DownloadOptions`…).
- `src/response.ts`: reading responses (internal): request ids, JSON bodies, and the `HinaiError` for an error status or an unreadable body.
- `src/archive.ts`: reading a download into an `.osz` `Blob` with progress and the zip check (internal), and `OSZ_MIME`.
- `src/errors.ts`: `HinaiError` and `HinaiErrorCode`.
- `src/retry.ts`: `parseRetryAfter`, `backoffDelayMs`, `MAX_RETRY_DELAY_MS`.
- `src/schemas.ts`: zod schemas for the mirror's error body and availability response. Internal, not exported.
- `tests/`: Vitest. `tests/helpers/` holds the msw handlers for the mirror, `tests/helpers/stub-fetch.ts` the stub-fetch client for tests that don't need msw, `tests/fixtures/` the JSON responses. Tests are split by subject (`beatmaps`, `availability`, `downloads`, `timeouts`, `aborts`, `errors`, `request-ids`, `inputs`, `retry`); `tests/exports.test.ts` pins the runtime and type exports.
- `scripts/smoke.mjs`: imports the built `dist/` and runs it against a stub fetch (`bun run test:dist`).
- `scripts/check-consumer.mjs`: packs the package into a throwaway project with a given zod version, then typechecks a strict consumer and runs it (`bun run check:consumer <zod version>`).
- `llms.txt`: an index of the docs for LLMs. It lives in the repo only; don't add it to `files` in `package.json`.

## Rules

- **Browser-first.** Send no custom headers unless the caller passes `userAgent` (servers only): extra headers force a CORS preflight. Stream downloads; never buffer through a server.
- **Shapes come from `@haruhimemoe/osu/shapes`.** Never copy osu!'s row schema here, and never import `@haruhimemoe/osu` itself (its client holds secrets and isn't needed). Shape changes belong in `@haruhimemoe/osu`, not here.
- **Lockstep with osu.** `@haruhimemoe/osu` is a regular (not peer) dependency, pinned `^0.2.0`, and its `BeatmapMeta` type crosses this package's public API. Below 1.0 every osu minor can break its shapes, so every `@haruhimemoe/osu` minor release needs a matching hinai release. Otherwise an app that also depends on osu directly can end up with two copies of osu and two drifted `BeatmapMeta` types.
- **Every failure is a `HinaiError`** with a code and an honest `retryable`, except aborts, which reject with the signal's reason (check the caller's signal wherever a body is read), and errors thrown by the caller's `onProgress`, which pass through as they are. Once a response has arrived, every `HinaiError` carries its `requestId` and `forensicsUrl`, timeouts and broken-off downloads included. Bad arguments (set ids, `baseUrl`, `timeoutMs`) throw `RangeError` before any request.
- **Timeouts:** metadata and availability requests are timed end to end (`timeoutMs`, default `HINAI_TIMEOUT_MS`). Downloads are timed only until the headers arrive; never put a total timeout on a download.
- **No orchestration.** Queues, caches, concurrency and app wording belong in apps. This package does one request well.
- **Tests never call the mirror.** msw and stub fetches only; `.osz` fixtures are synthetic zips (real ones are copyrighted).
- **Public API is pinned** by `tests/exports.test.ts`: the runtime exports by snapshot, the type exports by `bun run typecheck`. Adding or removing an export is a semver decision: note it in `CHANGELOG.md`.
- **Docs match the code.** `README.md` documents every export, option, default and error code. Change it in the same commit as the code, and update `llms.txt` when a README section is added, renamed or removed.
- **Changelog:** user-visible changes get a line under `## [Unreleased]` in `CHANGELOG.md` (Keep a Changelog 1.1.0). Never rewrite a released entry.
- **Releases are cut by the maintainers.** Don't bump the version, tag or publish.
- Code style: Biome (2 spaces, double quotes, 100 columns). Every file starts with the `@file / @desc / @author / @created / @modified` header. Exported functions get JSDoc with `@function`, `@param`, `@returns`. Imports in `src/` use `.js` extensions.

## Before calling a change done

```sh
bun run check && bun run typecheck && bun run test:coverage && bun run test:dist
bun run check:consumer 4.0.16 && bun run check:consumer latest
```

Coverage must stay at or above the 95% floor in `vitest.config.ts`. The consumer check needs the npm registry.
