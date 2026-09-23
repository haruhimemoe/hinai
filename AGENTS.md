# AGENTS.md

`@haruhimemoe/hinai`: a client for the hinai beatmap mirror. Metadata (as `@haruhimemoe/osu/shapes` BeatmapMeta), availability, and `.osz` downloads.

## Rules

- **Browser-first.** Send no custom headers unless the caller passes `userAgent` (servers only): extra headers force a CORS preflight. Stream downloads; never buffer through a server.
- **Shapes come from `@haruhimemoe/osu/shapes`.** Never copy osu!'s row schema here, and never import `@haruhimemoe/osu` itself (the client holds secrets and isn't needed).
- **Every failure is a `HinaiError`** with a code and an honest `retryable`, except aborts, which reject with the signal's reason (check the caller's signal wherever a body is read), and errors thrown by the caller's `onProgress`, which pass through as they are. Bad arguments (set ids, `baseUrl`, `timeoutMs`) throw `RangeError` before any request.
- **Timeouts:** metadata and availability requests are timed end to end (`timeoutMs`, default `HINAI_TIMEOUT_MS`). Downloads are timed only until the headers arrive; never put a total timeout on a download.
- **No orchestration.** Queues, caches, concurrency and app wording belong in apps. This package does one request well.
- **Tests never call the mirror.** msw and stub fetches only; `.osz` fixtures are synthetic zips (real ones are copyrighted).
- **Publish order:** `@haruhimemoe/osu` must be on npm before this package installs from the registry (and before CI can pass). Until then `bun.lock` is untracked (listed in `.git/info/exclude`): don't commit it, and don't take it out of the exclude list early.
  - Local development now: the rest was installed with the osu dependency set aside (so the local `bun.lock` doesn't list it), and `node_modules/@haruhimemoe/osu` is a symlink to `../../../osu`, the sibling checkout. Run `bun run build` in `../osu` when its `dist/` is stale; never edit osu from here. If an install removes the link: `ln -sfn ../../../osu node_modules/@haruhimemoe/osu`. README "Develop" has the steps from scratch.
  - Release: publish `@haruhimemoe/osu` first. Then here delete the symlink and the local `bun.lock`, `bun install` from the registry, take `bun.lock` out of `.git/info/exclude`, commit it, push. CI (`bun install --frozen-lockfile`) can pass only after that.
- **Public API is pinned** by `tests/exports.test.ts`. Adding or removing an export is a semver decision: note it in `CHANGELOG.md`.
- Code style: Biome (2 spaces, double quotes, 100 columns). Every file starts with the `@file / @desc / @author / @created / @modified` header. Exported functions get JSDoc with `@function`, `@param`, `@returns`. Imports in `src/` use `.js` extensions.

## Before calling a change done

```sh
bun run check && bun run typecheck && bun run test:coverage && bun run test:dist
node scripts/check-consumer.mjs 4.0.16 ../osu && node scripts/check-consumer.mjs latest ../osu
```

Coverage must stay at or above the 95% floor in `vitest.config.ts`.
