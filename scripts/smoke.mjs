/**
 * @file scripts/smoke.mjs
 * @desc Imports the built package the way apps will (dist/, with @haruhimemoe/osu/shapes, and the
 *       /testing entry with msw) and runs a metadata lookup and a download against a stub fetch
 *       fed by the testing fixtures. Run by `bun run test:dist`.
 * @author David @dvhsh (https://dvh.sh)
 * @created Wed Sep 23, 2026
 * @modified Mon Sep 28, 2026
 */

import assert from "node:assert/strict";
import { createHinaiClient, HinaiError } from "../dist/index.js";
import { fakeOsz, hinaiHandlers, recordedBeatmaps } from "../dist/testing/index.js";

const [first] = recordedBeatmaps;
const zip = fakeOsz(39804);
const client = createHinaiClient({
  fetch: async (input) =>
    String(input).includes("/api/v1/hinai/d/")
      ? new Response(zip, { headers: { "content-length": String(zip.length) } })
      : Response.json(recordedBeatmaps),
});
const { found, missing } = await client.getBeatmaps([first.id, 1]);
assert.equal(found.get(first.id)?.beatmapId, first.id);
assert.deepEqual(missing, [1]);
const blob = await client.downloadSet(39804);
assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), zip);
await assert.rejects(
  createHinaiClient({ fetch: async () => new Response("nope") }).downloadSet(1),
  HinaiError,
);
assert.equal(hinaiHandlers.length, 3);
console.log("smoke: ok");
