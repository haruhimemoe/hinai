# Contributing

## Setup

You need [Bun](https://bun.sh) 1.4.2 (the version in `package.json`'s `packageManager`) and Node 22.12 or later (CI also uses the version in `.nvmrc`).

```sh
bun install
```

Read [AGENTS.md](./AGENTS.md) first, especially "Browser-first" and "Public API is pinned". It also lists where everything lives.

## Making a change

1. Branch from `main` (`feat/<topic>`, `fix/<topic>`).
2. Write a failing test in `tests/`, make it pass, and keep commits small and [Conventional](https://www.conventionalcommits.org/). Tests never call the mirror: use `msw` or a stub `fetch` (see `tests/helpers/`).
3. If you change an export, an option, a default or an error, update `README.md` in the same commit.
4. Run the full checks:

   ```sh
   bun run check && bun run typecheck && bun run test:coverage && bun run test:dist
   ```

   Coverage must stay at or above the 95% floor in `vitest.config.ts`. `bun run check:fix` applies Biome's formatting.

5. Check the package against a real consumer, with the oldest supported zod and the newest (needs the npm registry):

   ```sh
   bun run check:consumer 4.0.16
   bun run check:consumer latest
   ```

   To try an unreleased `@haruhimemoe/osu` change as well, add the path to your local copy of it after the zod version (for example `bun run check:consumer 4.0.16 path/to/osu`). It's packed and installed instead of the npm version. Run `bun run build` in that copy first: packing doesn't build it, so whatever is in its `dist/` gets tested.

6. Add a line to `CHANGELOG.md` under `## [Unreleased]`, in the right [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) section (Added, Changed, Deprecated, Removed, Fixed, Security).

Releases are cut by the maintainers.
