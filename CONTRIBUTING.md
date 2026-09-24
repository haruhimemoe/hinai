# Contributing

1. Read [AGENTS.md](./AGENTS.md), especially "Browser-first" and "Public API is pinned".
2. `bun install`.
3. Branch from `main` (`feat/<topic>`, `fix/<topic>`).
4. Write a failing test in `tests/`, make it pass, keep commits small and Conventional. Tests never call the mirror: use `msw` or a stub `fetch` (see `tests/helpers/`).
5. Run the full checks:

   ```sh
   bun run check && bun run typecheck && bun run test:coverage && bun run test:dist
   ```

   Coverage must stay at or above the 95% floor in `vitest.config.ts`.

6. To check against a real consumer (needs the npm registry):

   ```sh
   node scripts/check-consumer.mjs 4.0.16
   node scripts/check-consumer.mjs latest
   ```

   To test against an unreleased `@haruhimemoe/osu` change, pass its checkout instead: `node scripts/check-consumer.mjs 4.0.16 ../osu` packs `../osu` rather than installing osu from npm.

7. Add a line to `CHANGELOG.md` under `## [Unreleased]`, in the right [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) section (Added, Changed, Deprecated, Removed, Fixed, Security).

Releases are cut by the maintainers.
