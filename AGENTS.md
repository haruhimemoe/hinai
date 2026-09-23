# AGENTS.md

`@haruhimemoe/hinai`: a client for the hinai beatmap mirror. Metadata (as `@haruhimemoe/osu/shapes` BeatmapMeta), availability, and `.osz` downloads.

## Rules

- **Browser-first.** Send no custom headers unless the caller passes `userAgent` (servers only): extra headers force a CORS preflight. Stream downloads; never buffer through a server.
- **Shapes come from `@haruhimemoe/osu/shapes`.** Never copy osu!'s row schema here, and never import `@haruhimemoe/osu` itself (the client holds secrets and isn't needed).
- **Lockstep with osu.** `@haruhimemoe/osu` is a regular (not peer) dependency, pinned `^0.1.0`, and its `BeatmapMeta` type crosses this package's public API. Below 1.0 every osu minor can break its shapes, so every `@haruhimemoe/osu` minor release needs a matching hinai release; otherwise an app that also depends on osu directly can end up with two copies of osu and two drifted `BeatmapMeta` types. To test an unreleased osu change, `node scripts/check-consumer.mjs 4.0.16 ../osu` packs the sibling checkout; never edit osu from here.
- **Every failure is a `HinaiError`** with a code and an honest `retryable`, except aborts, which reject with the signal's reason (check the caller's signal wherever a body is read), and errors thrown by the caller's `onProgress`, which pass through as they are. Bad arguments (set ids, `baseUrl`, `timeoutMs`) throw `RangeError` before any request.
- **Timeouts:** metadata and availability requests are timed end to end (`timeoutMs`, default `HINAI_TIMEOUT_MS`). Downloads are timed only until the headers arrive; never put a total timeout on a download.
- **No orchestration.** Queues, caches, concurrency and app wording belong in apps. This package does one request well.
- **Tests never call the mirror.** msw and stub fetches only; `.osz` fixtures are synthetic zips (real ones are copyrighted).
- **Public API is pinned** by `tests/exports.test.ts`. Adding or removing an export is a semver decision: note it in `CHANGELOG.md`.
- Code style: Biome (2 spaces, double quotes, 100 columns). Every file starts with the `@file / @desc / @author / @created / @modified` header. Exported functions get JSDoc with `@function`, `@param`, `@returns`. Imports in `src/` use `.js` extensions.

## Before calling a change done

```sh
bun run check && bun run typecheck && bun run test:coverage && bun run test:dist
node scripts/check-consumer.mjs 4.0.16 && node scripts/check-consumer.mjs latest
```

Coverage must stay at or above the 95% floor in `vitest.config.ts`.
