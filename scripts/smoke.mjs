/**
 * @file scripts/smoke.mjs
 * @desc Imports the built package the way apps will (dist/, with @haruhimemoe/osu/shapes) and
 *       runs a metadata lookup and a download against a stub fetch. Run by `bun run test:dist`.
 * @author David @dvhsh (https://dvh.sh)
 * @created Wed Sep 23, 2026
 * @modified Wed Sep 23, 2026
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHinaiClient, HinaiError } from "../dist/index.js";

const batch = JSON.parse(
  readFileSync(new URL("../tests/fixtures/beatmaps-batch.json", import.meta.url)),
);
const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);
const client = createHinaiClient({
  fetch: async (input) =>
    String(input).includes("/api/v1/hinai/d/")
      ? new Response(zip, { headers: { "content-length": String(zip.length) } })
      : Response.json(batch),
});
const { found, missing } = await client.getBeatmaps([batch[0].id, 1]);
assert.equal(found.get(batch[0].id)?.beatmapId, batch[0].id);
assert.deepEqual(missing, [1]);
const blob = await client.downloadSet(39804);
assert.equal(blob.size, zip.length);
await assert.rejects(
  createHinaiClient({ fetch: async () => new Response("nope") }).downloadSet(1),
  HinaiError,
);
console.log("smoke: ok");
