# Changelog

All notable changes to `@haruhimemoe/hinai`.

## 0.1.0 (unreleased)

- First release, extracted from packs.haruhime.moe's hinai client and downloader.
- `createHinaiClient({ baseUrl?, fetch?, userAgent? })` with `getBeatmaps`, `getAvailability` and `downloadSet`; `setDownloadUrl`, `OSZ_MIME`, `HinaiError`, `parseRetryAfter`, `backoffDelayMs`.
- Changes from packs:
  - One client instead of `createHinaiClient` plus `createHinaiDownloader`.
  - An optional `userAgent` for servers.
  - Beatmap shapes come from `@haruhimemoe/osu/shapes`.
  - No shared default instances.
- Needs `@haruhimemoe/osu` 0.1 on npm first.
