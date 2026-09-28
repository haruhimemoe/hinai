/**
 * @file src/testing/osz.ts
 * @desc fakeOsz: a tiny, valid, byte-for-byte repeatable .osz for tests. Real .osz files are
 *       copyrighted and never committed, so this is a zip holding one stand-in .osu file, stored
 *       uncompressed and written by hand (no zip library needed).
 * @author David @dvhsh (https://dvh.sh)
 * @created Mon Sep 28, 2026
 * @modified Mon Sep 28, 2026
 */

/** 2026-09-22 00:00 as an MS-DOS date (a fixed stamp keeps the bytes the same on every call). */
const DOS_DATE = ((2026 - 1980) << 9) | (9 << 5) | 22;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

/**
 * @function fakeOsz
 * @param setId {number} beatmapset id, written into the stand-in .osu file and its name
 * @returns {Uint8Array<ArrayBuffer>} a zip with one stored entry, `<setId>.osu`, the same bytes on
 *          every call
 */
export const fakeOsz = (setId: number): Uint8Array<ArrayBuffer> => {
  const name = new TextEncoder().encode(`${setId}.osu`);
  const data = new TextEncoder().encode(`osu file format v14\n// set ${setId}\n`);
  const local = 30 + name.length;
  const central = 46 + name.length;
  const bytes = new Uint8Array(local + data.length + central + 22);
  const view = new DataView(bytes.buffer);
  const u16 = (at: number, value: number) => view.setUint16(at, value, true);
  const u32 = (at: number, value: number) => view.setUint32(at, value, true);
  // Version needed (2.0), flags, method (0: stored), time, date, CRC-32, sizes, name length:
  // the same 26 bytes in the local header (from offset 4) and the central one (from offset 6).
  const entry = (at: number) => {
    u16(at, 20);
    u16(at + 8, DOS_DATE);
    u32(at + 10, crc32(data));
    u32(at + 14, data.length);
    u32(at + 18, data.length);
    u16(at + 22, name.length);
  };
  u32(0, 0x04034b50);
  entry(4);
  bytes.set(name, 30);
  bytes.set(data, local);
  const cd = local + data.length;
  u32(cd, 0x02014b50);
  u16(cd + 4, 20);
  entry(cd + 6);
  bytes.set(name, cd + 46);
  const end = cd + central;
  u32(end, 0x06054b50);
  u16(end + 8, 1);
  u16(end + 10, 1);
  u32(end + 12, central);
  u32(end + 16, cd);
  return bytes;
};
