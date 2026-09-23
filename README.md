# @haruhimemoe/hinai

A client for the [hinai beatmap mirror](https://mirror.hinamizawa.ai) (mirror.hinamizawa.ai), used by the haruhime.moe tools:

- **Metadata:** difficulties by id, 100 per call, as `BeatmapMeta` from [`@haruhimemoe/osu/shapes`](https://github.com/haruhimemoe/osu). Ids the mirror doesn't know come back in `missing`, and so do ids that aren't positive integers (those are never sent).
- **Availability:** whether a set can be downloaded (a DMCA or other takedown says no).
- **Downloads:** a set's `.osz`, streamed with progress and abort. It's the no-video archive by default, and the first bytes are checked to really be a zip.
- **Errors that say what to do:** every failure is a `HinaiError` with a `code`, whether trying again can help (`retryable`), the mirror's `Retry-After`, its `hint`, and the `requestId` to quote.
- **Timeouts:** metadata and availability requests give up after 10 s (`timeoutMs`). A download only waits that long for the mirror to start answering, then streams for as long as it takes.

No auth, and CORS is open, so it runs in browsers and workers as well as on servers.

## Install

```sh
bun add @haruhimemoe/hinai zod
```

It depends on `@haruhimemoe/osu` for the beatmap shapes. `zod` (4.0.16 or later in 4.x) is a peer dependency.

**Compatibility:** Node >= 22.12 on servers. In browsers and workers: Safari 17.4+, Chrome 120+, or Firefox 124+ (the floor is `AbortSignal.any` and `URL.canParse`; older engines throw a plain `TypeError` instead of a `HinaiError`).

## Use

```ts
import { backoffDelayMs, createHinaiClient, HinaiError } from "@haruhimemoe/hinai";

const hinai = createHinaiClient(); // in a browser
// On a server, say who you are, as the mirror asks:
// createHinaiClient({ userAgent: "pools.haruhime.moe (+https://pools.haruhime.moe)" })

const controller = new AbortController();

const { found, missing } = await hinai.getBeatmaps([129891, 75], { signal: controller.signal });

const { downloadable, reason } = await hinai.getAvailability(39804, { signal: controller.signal });
const osz = await hinai.downloadSet(39804, {
  video: false,
  signal: controller.signal,
  onProgress: ({ loaded, total }) => console.log(loaded, total),
});
```

`downloadSet` resolves to a `Blob` (type `application/x-osu-beatmap-archive`). An abort rejects with the signal's reason, not a `HinaiError`, and so does an error your `onProgress` throws.

`getAvailability` throws `not_found` for a set the mirror doesn't know. When the mirror doesn't know whether a set is blocked (`download_disabled: null`), it comes back as `downloadable: true`.

Options:

| Option | Default | Notes |
| --- | --- | --- |
| `baseUrl` | `https://mirror.hinamizawa.ai` (`HINAI_BASE_URL`) | Absolute http(s) URL, else a `RangeError`. Trailing slashes are dropped. |
| `userAgent` | none | Servers only. Ignored in a browser (where `document` exists) or a worker (`self` with no `window`): pages and workers can't set it, and an extra header would force a CORS preflight. |
| `timeoutMs` | `10_000` (`HINAI_TIMEOUT_MS`) | Per metadata or availability request, body included. For a download, only until the headers arrive. Must be an integer from 1 to 2147483647 (2^31 - 1: `setTimeout`'s own limit), else a `RangeError`. |
| `fetch` | `globalThis.fetch` | For tests or a custom agent. |

Set ids that aren't positive integers throw a `RangeError` before any request. `getBeatmaps` batches at most `HINAI_BATCH_LIMIT` (100) ids per call.

### Retrying

```ts
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function downloadWithRetries(setId: number) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await hinai.downloadSet(setId);
    } catch (error) {
      if (!(error instanceof HinaiError) || !error.retryable || attempt === 4) throw error;
      await sleep(backoffDelayMs(attempt, error.retryAfterMs)); // Retry-After, else 1s, 2s, 4s…
    }
  }
}
```

`backoffDelayMs` and `parseRetryAfter` cap their wait at `MAX_RETRY_DELAY_MS` (60 s).

| `code` | Meaning | Retry? |
| --- | --- | --- |
| `network` | Couldn't reach the mirror, or a download broke off | yes |
| `timeout` | No answer within `timeoutMs` (`status` is null) | yes |
| `bad_response` | A 200 whose body isn't what it should be (not JSON, not a zip) | yes |
| `not_found` | A 404: the mirror doesn't have the set | no |
| `http_error` | Another status, without the mirror's error body | 5xx and 429 only |
| anything else | The mirror's own code (e.g. `too_many_ids`, `upstream_relay_shed`) | as the mirror says |

## Etiquette

- **Downloads are limited to 1000 requests a minute per IP.** JSON endpoints aren't metered. Download a few sets at a time (4 works well), cache what you downloaded, and honor `Retry-After`.
- **Ids:** metadata takes difficulty ids; downloads and availability take set ids (`beatmapsetId`).
- **Debugging:** every response carries `x-hinai-request-id` and, on an error, `x-hinai-forensics`; a `HinaiError` keeps them as `requestId` and `forensicsUrl` (null when a header is missing or a browser can't read it). Include both when reporting a problem to the mirror's maintainer.
- **Don't re-host `.osz` files.** Rights holders use the mirror's [takedown process](https://mirror.hinamizawa.ai/docs/content-takedowns).
- The full API is in the mirror's OpenAPI document: https://mirror.hinamizawa.ai/api/v1/hinai/openapi.json

## License

MIT. See [LICENSE](LICENSE). Not affiliated with the hinai mirror, osu! or ppy Pty Ltd.

## Develop

`@haruhimemoe/osu` isn't on npm yet, so `bun install` can't resolve it from the registry, and `bun.lock` stays out of git for now (it's in `.git/info/exclude`). Until then, with an osu checkout next to this one (`../osu`):

1. Install everything else: drop the `@haruhimemoe/osu` line from `dependencies` for a moment, run `bun install`, then put the line back. Don't commit that edit.
2. Link the checkout: `ln -sfn ../../../osu node_modules/@haruhimemoe/osu`.
3. Build it, since the link points at osu's `dist/`: `(cd ../osu && bun run build)`. Rebuild whenever osu changes.

Then:

```sh
bun run check && bun run typecheck && bun run test:coverage && bun run test:dist
node scripts/check-consumer.mjs 4.0.16 ../osu   # packs ../osu instead of pulling it from npm
node scripts/check-consumer.mjs latest ../osu
```

CI runs `bun install --frozen-lockfile`, so it can't pass until a lockfile is committed. To release:

1. Publish `@haruhimemoe/osu` 0.1 to npm.
2. Here: delete the symlink and the local `bun.lock`, then `bun install`, which now resolves osu from the registry.
3. Before committing the lockfile, run the full checks against the registry copy of osu (no `../osu` argument): `bun run check && bun run typecheck && bun run test:coverage && bun run test:dist && node scripts/check-consumer.mjs 4.0.16`. This proves the published osu has the `./shapes` export hinai needs.
4. Take `bun.lock` out of `.git/info/exclude` and commit it.
5. Push. Once CI passes, publish this package: tag a GitHub Release `v0.1.0` (release.yml checks the tag against `package.json`).

Publishing itself is `release.yml`, gated by a GitHub environment named `npm` plus an npm trusted-publisher entry for that workflow. npm only lets you configure a trusted publisher on a package that already exists on the registry, so the very first release goes out by hand from a clean checkout of the tagged commit, after `bun run build` and all checks pass: `npm publish --access public --provenance=false`. Then configure the trusted publisher (`npm trust github @haruhimemoe/hinai --file release.yml --repo haruhimemoe/hinai --env npm --allow-publish`, needs npm >= 11.15.0 and 2FA), and every later release goes through `release.yml`.
