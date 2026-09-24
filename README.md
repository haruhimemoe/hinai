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

## Usage

```ts
import { createHinaiClient } from "@haruhimemoe/hinai";

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

Options to `createHinaiClient`:

| Option | Default | Notes |
| --- | --- | --- |
| `baseUrl` | `https://mirror.hinamizawa.ai` (`HINAI_BASE_URL`) | Absolute http(s) URL, else a `RangeError`. Trailing slashes are dropped. |
| `userAgent` | none | Servers only. Ignored in a browser (where `document` exists) or a worker (`self` with no `window`): pages and workers can't set it, and an extra header would force a CORS preflight. |
| `timeoutMs` | `10_000` (`HINAI_TIMEOUT_MS`) | Per metadata or availability request, body included. For a download, only until the headers arrive. Must be an integer from 1 to 2147483647 (2^31 - 1: `setTimeout`'s own limit), else a `RangeError`. |
| `fetch` | `globalThis.fetch` | For tests or a custom agent. |

Set ids that aren't positive integers throw a `RangeError` before any request. `getBeatmaps` batches at most `HINAI_BATCH_LIMIT` (100) ids per call.

## API

Everything below is exported from `@haruhimemoe/hinai`.

**Client**

| Export | Description |
| --- | --- |
| `createHinaiClient(options?)` | Builds the client: `getBeatmaps`, `getAvailability`, `downloadSet` (below). |
| `HinaiClient` | Type of the object `createHinaiClient` returns. |
| `HinaiClientOptions` | `baseUrl`, `fetch`, `userAgent`, `timeoutMs` — see the Options table above. |
| `setDownloadUrl(setId, baseUrl?, video?)` | The `.osz` URL for a set, without downloading it. Throws `RangeError` for a bad `setId`. |
| `HINAI_BASE_URL` | Default `baseUrl`: `"https://mirror.hinamizawa.ai"`. |
| `HINAI_TIMEOUT_MS` | Default `timeoutMs`: `10_000`. |
| `HINAI_BATCH_LIMIT` | Max ids per `getBeatmaps` call: `100`. |
| `OSZ_MIME` | MIME type of the `Blob` `downloadSet` resolves to: `"application/x-osu-beatmap-archive"`. |

**Methods (on the object `createHinaiClient` returns) and their shapes**

| Export | Description |
| --- | --- |
| `getBeatmaps(ids, options?)` | `Promise<BeatmapLookup>`: metadata for every id the mirror knows. |
| `BeatmapLookup` | `{ found: Map<number, BeatmapMeta>; missing: number[] }` |
| `BeatmapOptions` | `{ signal? }` |
| `getAvailability(setId, options?)` | `Promise<SetAvailability>`. Throws `RangeError` for a bad `setId`. |
| `SetAvailability` | `{ downloadable: boolean; reason: string \| null }` |
| `AvailabilityOptions` | `{ signal? }` |
| `downloadSet(setId, options?)` | `Promise<Blob>`. Throws `RangeError` for a bad `setId`. |
| `DownloadOptions` | `{ signal?; onProgress?; video? }` |
| `DownloadProgress` | `{ loaded: number; total: number \| null }` |

**Errors and retry**

| Export | Description |
| --- | --- |
| `HinaiError` | `extends Error`. `code`, `status`, `retryable`, `retryAfterMs`, `requestId`, `hint`, `forensicsUrl`. |
| `HinaiErrorCode` | The client's own codes (`network`, `timeout`, `bad_response`, `not_found`, `http_error`), or any string (the mirror's own, e.g. `too_many_ids`). |
| `backoffDelayMs(attempt, retryAfterMs)` | ms to wait before retrying: the server's `Retry-After`, else 1s, 2s, 4s… |
| `parseRetryAfter(header, now)` | Parses a `Retry-After` header (delta-seconds or an HTTP date) into ms. |
| `MAX_RETRY_DELAY_MS` | Cap on both of the above: `60_000`. |

### Retrying

```ts
import { backoffDelayMs, createHinaiClient, HinaiError } from "@haruhimemoe/hinai";

const hinai = createHinaiClient();
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

### Errors

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

## Compatibility

- **Node:** >= 22.12 on servers.
- **Browsers and workers:** Safari 17.4+, Chrome 120+, or Firefox 124+ (the floor is `AbortSignal.any` and `URL.canParse`; older engines throw a plain `TypeError` instead of a `HinaiError`).
- **Peer dependency:** `zod` ^4.0.16.

## License

MIT. See [LICENSE](LICENSE). Not affiliated with the hinai mirror, osu! or ppy Pty Ltd.

---

See [CHANGELOG.md](CHANGELOG.md) for release history and [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute.
