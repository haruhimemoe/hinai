# AGENTS.md

`@haruhimemoe/hinai`: a client for the hinai beatmap mirror. Metadata (as `@haruhimemoe/osu/shapes` BeatmapMeta), availability, and `.osz` downloads.

## Rules

- **Browser-first.** Send no custom headers unless the caller passes `userAgent` (servers only): extra headers force a CORS preflight. Stream downloads; never buffer through a server.
- **Shapes come from `@haruhimemoe/osu/shapes`.** Never copy osu!'s row schema here, and never import `@haruhimemoe/osu` itself (the client holds secrets and isn't needed).
- **Every failure is a `HinaiError`** with a code and an honest `retryable`, except aborts, which reject with the signal's reason.
- **No orchestration.** Queues, caches, concurrency and app wording belong in apps. This package does one request well.
- **Tests never call the mirror.** msw and stub fetches only; `.osz` fixtures are synthetic zips (real ones are copyrighted).
- **Publish order:** `@haruhimemoe/osu` must be on npm before this package installs from the registry (and before CI can pass).
- **Public API is pinned** by `tests/exports.test.ts`. Adding or removing an export is a semver decision: note it in `CHANGELOG.md`.
- Code style: Biome (2 spaces, double quotes, 100 columns). Every file starts with the `@file / @desc / @author / @created / @modified` header. Exported functions get JSDoc with `@function`, `@param`, `@returns`. Imports in `src/` use `.js` extensions.

## Before calling a change done

```sh
bun run check && bun run typecheck && bun run test && bun run test:dist
```
