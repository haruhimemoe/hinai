# @haruhimemoe/hinai

A client for the [hinai beatmap mirror](https://mirror.hinamizawa.ai) (mirror.hinamizawa.ai), used by the haruhime.moe tools:

- **Metadata:** difficulties by id, 100 per call, as `BeatmapMeta` from [`@haruhimemoe/osu/shapes`](https://github.com/haruhimemoe/osu). Ids the mirror doesn't know come back in `missing`.
- **Availability:** whether a set can be downloaded (a DMCA or other takedown says no).
- **Downloads:** a set's `.osz`, streamed with progress and abort. It's the no-video archive by default, and the result is checked to really be a zip.
- **Errors that say what to do:** every failure is a `HinaiError` with a `code`, whether trying again can help (`retryable`), and the mirror's `Retry-After`.

No auth, and CORS is open, so it runs in browsers as well as on servers.

## Install

```sh
bun add @haruhimemoe/hinai zod
```

It depends on `@haruhimemoe/osu` for the beatmap shapes. `zod` (4.0.16 or later in 4.x) is a peer dependency.

## Use

```ts
import { backoffDelayMs, createHinaiClient, HinaiError } from "@haruhimemoe/hinai";

const hinai = createHinaiClient(); // in a browser
// On a server, say who you are, as the mirror asks:
// createHinaiClient({ userAgent: "pools.haruhime.moe (+https://pools.haruhime.moe)" })

const { found, missing } = await hinai.getBeatmaps([129891, 75]);

const { downloadable, reason } = await hinai.getAvailability(39804);
const osz = await hinai.downloadSet(39804, {
  video: false,
  signal: controller.signal,
  onProgress: ({ loaded, total }) => render(loaded, total),
});
```

`downloadSet` resolves to a `Blob` (type `application/x-osu-beatmap-archive`). An abort rejects with the signal's reason, not a `HinaiError`.

### Retrying

```ts
for (let attempt = 1; ; attempt++) {
  try {
    return await hinai.downloadSet(setId);
  } catch (error) {
    if (!(error instanceof HinaiError) || !error.retryable || attempt === 4) throw error;
    await sleep(backoffDelayMs(attempt, error.retryAfterMs)); // Retry-After, else 1s, 2s, 4s…
  }
}
```

| `code` | Meaning | Retry? |
| --- | --- | --- |
| `network` | Couldn't reach the mirror, or a download broke off | yes |
| `bad_response` | A body that isn't what it should be (not JSON, not a zip) | yes |
| `not_found` | The mirror doesn't have the set (404) | no |
| `http_error` | Another status, with no error body | 5xx and 429 only |
| anything else | The mirror's own code (e.g. `too_many_ids`, `upstream_relay_shed`) | as the mirror says |

## Etiquette

- **Downloads are limited to 1000 requests a minute per IP.** JSON endpoints aren't metered. Download a few sets at a time (4 works well), cache what you downloaded, and honor `Retry-After`.
- **Ids:** metadata takes difficulty ids; downloads and availability take set ids (`beatmapsetId`).
- **Debugging:** every response carries `x-hinai-request-id`. Include it when reporting a problem to the mirror's maintainer.
- **Don't re-host `.osz` files.** Rights holders use the mirror's [takedown process](https://mirror.hinamizawa.ai/docs/content-takedowns).
- The full API is in the mirror's OpenAPI document: https://mirror.hinamizawa.ai/api/v1/hinai/openapi.json

## License

MIT. See [LICENSE](LICENSE). Not affiliated with the hinai mirror, osu! or ppy Pty Ltd.

## Develop

```sh
bun install
bun run check && bun run typecheck && bun run test && bun run test:dist
node scripts/check-consumer.mjs 4.0.16 ../osu   # a local osu checkout, until it's published
```
