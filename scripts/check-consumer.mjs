/**
 * @file scripts/check-consumer.mjs
 * @desc Installs the packed package with a given zod version into a throwaway project, then
 *       typechecks a consumer strictly (no skipLibCheck, so broken .d.ts can't hide as `any`) and
 *       runs it. Proves the zod peer range's floor. Usage: node scripts/check-consumer.mjs <zod
 *       version> [local package dirs...] (after `bun run build`). Needs the npm registry; list
 *       sibling packages (e.g. ../osu) to install them from their own tarballs instead, before
 *       they're published.
 * @author David @dvhsh (https://dvh.sh)
 * @created Wed Sep 23, 2026
 * @modified Wed Sep 23, 2026
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [zod, ...locals] = process.argv.slice(2);
if (!zod) throw new Error("usage: node scripts/check-consumer.mjs <zod version> [local dirs...]");
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const dir = mkdtempSync(path.join(tmpdir(), "hinai-consumer-"));
const run = (command, args, cwd = dir) =>
  execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const pack = (from) =>
  path.join(dir, run("npm", ["pack", "--silent", "--pack-destination", dir], from).trim());

const CONSUMER = `import type { BeatmapMeta } from "@haruhimemoe/osu/shapes";
import {
  type BeatmapLookup,
  createHinaiClient,
  type HinaiClient,
  HinaiError,
  setDownloadUrl,
} from "@haruhimemoe/hinai";

const row = {
  id: 75,
  beatmapset_id: 1,
  mode: "osu",
  version: "Normal",
  difficulty_rating: 2.55,
  cs: 4,
  ar: 6,
  accuracy: 6,
  drain: 6,
  bpm: 120,
  total_length: 142,
  checksum: null,
  beatmapset: { artist: "a", title: "t", creator: "c", user_id: 2 },
};
const client: HinaiClient = createHinaiClient({ fetch: async () => Response.json([row]) });
const lookup: BeatmapLookup = await client.getBeatmaps([75, 76]);
const meta: BeatmapMeta | undefined = lookup.found.get(75);
// @ts-expect-error found holds BeatmapMeta, not strings (it would accept this if types were any)
const wrong: string | undefined = lookup.found.get(75);
if (meta?.title !== "t" || lookup.missing[0] !== 76) throw new Error("lookup");
if (!setDownloadUrl(1).endsWith("?noVideo=true")) throw new Error("url");
if (!(new HinaiError("x", "y") instanceof Error)) throw new Error("error");
void wrong;
console.log("consumer: ok");
`;

try {
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type: "module", private: true }));
  const tarballs = [...locals.map((local) => pack(path.resolve(local))), pack(root)];
  run("npm", ["install", "--silent", "--no-audit", "--no-fund", ...tarballs, `zod@${zod}`]);
  writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        exactOptionalPropertyTypes: true,
        noEmit: true,
        skipLibCheck: false,
        module: "nodenext",
        moduleResolution: "nodenext",
        target: "ES2023",
        lib: ["ES2023", "DOM", "DOM.Iterable"],
        types: [],
      },
      files: ["consumer.ts"],
    }),
  );
  writeFileSync(path.join(dir, "consumer.ts"), CONSUMER);
  run(path.join(root, "node_modules", ".bin", "tsc"), ["-p", dir]);
  run(process.execPath, ["--experimental-strip-types", "--no-warnings", "consumer.ts"]);
  console.log(`zod ${zod}: ok`);
} catch (error) {
  console.error(`zod ${zod}: FAILED\n${error.stdout ?? ""}${error.stderr ?? error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
