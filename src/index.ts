/**
 * @file src/index.ts
 * @desc @haruhimemoe/hinai: a client for the hinai beatmap mirror (mirror.hinamizawa.ai).
 *       Metadata as @haruhimemoe/osu's BeatmapMeta, availability, and .osz downloads, with
 *       errors that say whether and when to retry.
 * @author David @dvhsh (https://dvh.sh)
 * @created Wed Sep 23, 2026
 * @modified Wed Sep 23, 2026
 */

export * from "./client.js";
export * from "./errors.js";
export * from "./retry.js";
