/**
 * @file src/schemas.ts
 * @desc Zod shapes for hinai-specific responses (errors, availability). Beatmap rows use the
 *       shared osu!-v2 row in src/schemas/osu-beatmap.ts.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Wed Sep 23, 2026
 */

import { z } from "zod";

/** hinai's JSON error object (HTTP 4xx/5xx). */
export const hinaiErrorSchema = z.object({
  code: z.string(),
  error: z.string(),
  hint: z.string().optional(),
  retryable: z.boolean().optional(),
});

/** GET /api/s/{setId}/availability (cross-mirror shape); only the fields we act on. */
export const hinaiAvailabilitySchema = z.object({
  id: z.number().int(),
  availability: z.object({
    download_disabled: z.boolean().nullable(),
    more_information: z.string().nullable(),
  }),
});
