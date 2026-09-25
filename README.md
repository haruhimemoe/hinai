<p align="center"><a href="https://github.com/haruhimemoe/hinai"><picture><source media="(prefers-color-scheme: light)" srcset="https://www.haruhime.moe/brand/repos/hinai-banner-on-light.svg"><img alt="@haruhimemoe/hinai" src="https://www.haruhime.moe/brand/repos/hinai-banner.svg" width="640"></picture></a></p>

# @haruhimemoe/hinai

A client for the [hinai beatmap mirror](https://mirror.hinamizawa.ai) (mirror.hinamizawa.ai), used by the haruhime.moe tools:

- **Metadata:** difficulties by id, as `BeatmapMeta` from [`@haruhimemoe/osu/shapes`](https://github.com/haruhimemoe/osu#shapes). Pass as many ids as you like; the client asks the mirror 100 at a time. Ids the mirror doesn't know come back in `missing`, and so do ids that aren't positive integers (those are never sent).
- **Availability:** whether a set can be downloaded (a DMCA or other takedown says no).
- **Downloads:** a set's `.osz`, read chunk by chunk with progress and abort. It's the no-video archive by default, and the first bytes are checked to really be a zip.
- **Errors that say what to do:** a failed request rejects with a `HinaiError` that has a `code`, whether trying again can help (`retryable`), the mirror's `Retry-After`, its `hint`, and the `requestId` and `forensicsUrl` to quote. Aborts, bad arguments and errors thrown by your `onProgress` are the exceptions (see [Aborts and bad arguments](#aborts-and-bad-arguments)).
- **Timeouts:** metadata and availability requests give up after 10 s (`timeoutMs`). A download only waits that long for the mirror to start answering, then streams for as long as it takes.

No auth, and CORS is open, so it runs in browsers and workers as well as on servers.

## Install

```sh
npm install @haruhimemoe/hinai zod
# or
bun add @haruhimemoe/hinai zod
```

`zod` (4.0.16 or later in 4.x) is a peer dependency. `@haruhimemoe/osu` installs with it; only its beatmap shapes (`@haruhimemoe/osu/shapes`) are used, not its API client. If your app imports `@haruhimemoe/osu` too, keep it on a matching version (0.2.x for this release), so there's one copy and one `BeatmapMeta` type.

## Usage

```ts
import { createHinaiClient } from "@haruhimemoe/hinai";

const hinai = createHinaiClient(); // in a browser
// On a server, say who you are, as the mirror asks:
// createHinaiClient({ userAgent: "my-app/1.0 (+https://example.com)" })

const controller = new AbortController();

// Metadata takes difficulty ids.
const { found, missing } = await hinai.getBeatmaps([129891, 75], { signal: controller.signal });
for (const [id, meta] of found) console.log(id, meta.artist, meta.title, meta.version);
console.log("not on the mirror:", missing);

// Availability and downloads take set ids.
const { downloadable, reason } = await hinai.getAvailability(39804, { signal: controller.signal });
if (downloadable) {
  const osz = await hinai.downloadSet(39804, {
    video: false,
    signal: controller.signal,
    onProgress: ({ loaded, total }) => console.log(loaded, total),
  });
  console.log(osz.size, osz.type); // type is "application/x-osu-beatmap-archive"
} else {
  console.log("downloads are disabled:", reason);
}
```

### Metadata

`getBeatmaps(ids, { signal })` takes difficulty ids. Duplicates are fine.

- Valid ids go to the mirror in requests of 100 (`HINAI_BATCH_LIMIT`), one after another. If one request fails, the whole call rejects with that error.
- `found` is a `Map` from difficulty id to `BeatmapMeta`: ids, ruleset, title, artist, version, creator, CS/AR/OD/HP, BPM, length, star rating and md5 checksum. The fields are listed in [`@haruhimemoe/osu`](https://github.com/haruhimemoe/osu#shapes).
- `missing` has every id you passed that isn't in `found`, once each, in the order you passed them. That covers ids the mirror doesn't know, ids that aren't positive integers, and rows the mirror sent that don't parse as an osu! beatmap.
- A list with no valid ids sends no request.

### Availability

`getAvailability(setId, { signal })` takes a set id and resolves to `{ downloadable, reason }`.

- `downloadable` is `false` only when the mirror says downloads are disabled (a DMCA or other takedown). `reason` is the mirror's `more_information` text, or `null`.
- When the mirror doesn't know whether a set is blocked (`download_disabled: null`), `downloadable` is `true`: try the download.
- A set the mirror doesn't know rejects with a `HinaiError` whose code is `not_found`.

### Downloads

`downloadSet(setId, { video, signal, onProgress })` takes a set id and resolves to a `Blob` of type `application/x-osu-beatmap-archive` (`OSZ_MIME`), held in memory.

- `video: false` (the default) asks for the archive without its video. The mirror only keeps no-video archives itself, so `video: true` can be slower.
- The first 4 bytes must be the zip signature (`PK\x03\x04`), else the call rejects with `bad_response`.
- `onProgress` is called once per chunk, only after that check, with `{ loaded, total }`. `total` is the `content-length`, or `null` when the mirror didn't send one or the body turned out longer.
- `timeoutMs` only covers the wait for the response headers (and, on an error status, reading the mirror's error body). Once the archive streams, only your `signal` stops a download.
- `setDownloadUrl(setId, baseUrl?, video?)` builds the same URL without downloading anything.

### Aborts and bad arguments

- Every method takes a `signal`. An abort rejects with the signal's reason (a `DOMException` named `AbortError`, unless you aborted with a reason of your own), not a `HinaiError`. An error thrown by your `onProgress` also rejects the call as it is.
- `createHinaiClient` throws a `RangeError` for a bad `baseUrl` or `timeoutMs`, and `setDownloadUrl` for a bad set id.
- `getAvailability` and `downloadSet` reject with a `RangeError`, before any request, for a set id that isn't a positive integer.

### Options

Options to `createHinaiClient`:

| Option | Default | Notes |
| --- | --- | --- |
| `baseUrl` | `https://mirror.hinamizawa.ai` (`HINAI_BASE_URL`) | Absolute http(s) URL, else a `RangeError`. Trailing slashes are dropped. |
| `userAgent` | none | Sent as `User-Agent`, on servers only. Ignored in a browser (where `document` exists) or a worker (`self` with `importScripts` and no `window`): pages and workers can't set it, and an extra header would force a CORS preflight. |
| `timeoutMs` | `10_000` (`HINAI_TIMEOUT_MS`) | Per metadata or availability request, body included. For a download, only until the headers arrive (plus the error body on an error status). Must be an integer from 1 to 2147483647 (2^31 - 1: `setTimeout`'s own limit), else a `RangeError`. |
| `fetch` | `globalThis.fetch` | For tests or a custom agent. Without it, `globalThis.fetch` is looked up on every request, so a fetch mock installed later still applies. |

Every option, and every method option, also accepts `undefined`, which means "use the default".

## API

Everything below is exported from `@haruhimemoe/hinai`, except `getBeatmaps`, `getAvailability` and `downloadSet`, which are methods on the client.

**Client**

| Export | Description |
| --- | --- |
| `createHinaiClient(options?)` | Builds the client: `getBeatmaps`, `getAvailability`, `downloadSet` (below). |
| `HinaiClient` | Type of the object `createHinaiClient` returns. |
| `HinaiClientOptions` | `baseUrl`, `fetch`, `userAgent`, `timeoutMs`. See [Options](#options). |
| `setDownloadUrl(setId, baseUrl?, video?)` | The `.osz` URL for a set, without downloading it. No-video unless `video` is `true`. Throws `RangeError` for a bad `setId`. |
| `HINAI_BASE_URL` | Default `baseUrl`: `"https://mirror.hinamizawa.ai"`. |
| `HINAI_TIMEOUT_MS` | Default `timeoutMs`: `10_000`. |
| `HINAI_BATCH_LIMIT` | Ids per metadata request: `100`. `getBeatmaps` splits longer lists into requests of this size. |
| `OSZ_MIME` | MIME type of the `Blob` `downloadSet` resolves to: `"application/x-osu-beatmap-archive"`. |

**Methods (on the object `createHinaiClient` returns) and their shapes**

| Name | Description |
| --- | --- |
| `getBeatmaps(ids, options?)` | `Promise<BeatmapLookup>`: metadata for every difficulty id the mirror knows. |
| `BeatmapLookup` | `{ found: Map<number, BeatmapMeta>; missing: number[] }` |
| `BeatmapOptions` | `{ signal? }` |
| `getAvailability(setId, options?)` | `Promise<SetAvailability>`. Rejects with `RangeError` for a bad `setId`. |
| `SetAvailability` | `{ downloadable: boolean; reason: string \| null }` |
| `AvailabilityOptions` | `{ signal? }` |
| `downloadSet(setId, options?)` | `Promise<Blob>`. Rejects with `RangeError` for a bad `setId`. |
| `DownloadOptions` | `{ signal?; onProgress?; video? }` |
| `DownloadProgress` | `{ loaded: number; total: number \| null }` |

`BeatmapMeta` itself comes from `@haruhimemoe/osu/shapes`; this package doesn't re-export it.

**Errors and retry**

| Export | Description |
| --- | --- |
| `HinaiError` | `extends Error`, with `name` `"HinaiError"`. Fields in [Errors](#errors). |
| `HinaiErrorCode` | The client's own codes (`network`, `timeout`, `bad_response`, `not_found`, `http_error`), or any string (the mirror's own, e.g. `upstream_relay_shed`). |
| `backoffDelayMs(attempt, retryAfterMs)` | ms to wait after `attempt` failed tries (1-based): `retryAfterMs` when it isn't `null`, else 1s, 2s, 4s… capped at `MAX_RETRY_DELAY_MS`. |
| `parseRetryAfter(header, now)` | Parses a `Retry-After` header into ms, from 0 to `MAX_RETRY_DELAY_MS`. It reads delta-seconds (`"120"`) or an HTTP date in the IMF-fixdate form (`"Tue, 22 Sep 2026 12:00:03 GMT"`, measured from `now` in ms). `null` when the header is `null` or in any other form (`"1.5"`, `"-5"`, an ISO date). |
| `MAX_RETRY_DELAY_MS` | `60_000`: the cap on `parseRetryAfter`'s result and on the backoff. |

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

A `HinaiError` has:

| Field | Value |
| --- | --- |
| `code` | One of the codes below. |
| `message` | For the client's own codes, a sentence you can show to users. For the mirror's codes, the mirror's `error` text. |
| `status` | The HTTP status, or `null` for `network` and `timeout`. |
| `retryable` | Whether trying again can help. |
| `retryAfterMs` | The mirror's `Retry-After` in ms (at most 60 s) on an error status other than 404, else `null`. |
| `hint` | The mirror's `hint` from its error body, else `null`. |
| `requestId` | The response's `x-hinai-request-id`, else `null`. It is `null` when no response arrived (a `network` failure or a `timeout` before the headers). |
| `forensicsUrl` | The response's `x-hinai-forensics`, else `null`, as for `requestId`. |
| `cause` | The underlying error when there is one (for example fetch's `TypeError` or a JSON `SyntaxError`). |

| `code` | Meaning | Retry? |
| --- | --- | --- |
| `network` | Couldn't reach the mirror, or a download broke off | yes |
| `timeout` | No answer within `timeoutMs` | yes |
| `bad_response` | A success status whose body isn't what it should be (not JSON, not the expected shape, not a zip) | yes |
| `not_found` | A 404. For availability and downloads, the mirror doesn't have the set. For metadata, `baseUrl` has no metadata endpoint | no |
| `http_error` | Another error status, without the mirror's error body | 5xx and 429 only |
| anything else | The mirror's own code (e.g. `upstream_relay_shed`), with its `error` as the message | as the mirror says, else 5xx and 429 only |

## Etiquette

- **Downloads are limited to 1000 requests a minute per IP.** JSON endpoints aren't metered. Download one or two sets at a time, as the mirror asks, cache what you downloaded, and honor `Retry-After`.
- **Ids:** metadata takes difficulty ids; downloads and availability take set ids (`beatmapsetId`).
- **Debugging:** every mirror response carries `x-hinai-request-id` and `x-hinai-forensics` (a lookup URL for that request). A `HinaiError` keeps them as `requestId` and `forensicsUrl` whenever a response arrived. Include both when reporting a problem to the mirror's maintainers.
- **Don't re-host `.osz` files.** Rights holders use the mirror's [takedown process](https://mirror.hinamizawa.ai/docs/content-takedowns).
- The mirror's full API is in its [OpenAPI document](https://mirror.hinamizawa.ai/api/v1/hinai/openapi.json), with human docs at [mirror.hinamizawa.ai/docs](https://mirror.hinamizawa.ai/docs).

## Compatibility

- **Node:** 22.12 or later on servers.
- **Browsers and workers:** Safari 17.4+, Chrome 120+, or Firefox 124+ (the floor is `AbortSignal.any` and `URL.canParse`; older engines throw a plain `TypeError` instead of a `HinaiError`).
- **Module format:** ES modules, with TypeScript types included.
- **Dependencies:** `zod` ^4.0.16 (peer) and `@haruhimemoe/osu` ^0.2.0.

## License

MIT. See [LICENSE](LICENSE). Not affiliated with the hinai mirror, osu! or ppy Pty Ltd.

---

See [CHANGELOG.md](CHANGELOG.md) for release history and [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute.
