/**
 * @file src/schemas.ts
 * @desc Zod shapes for hinai-specific responses (errors, availability). Beatmap rows use the
 *       osu!-v2 row schema from @haruhimemoe/osu/shapes.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Wed Sep 23, 2026
 */

import { z } from "zod";

/** hinai's JSON error object (HTTP 4xx/5xx). `hint` and `retryable` may be absent or null. */
export const hinaiErrorSchema = z.object({
  code: z.string(),
  error: z.string(),
  hint: z.string().nullish(),
  retryable: z.boolean().nullish(),
});

/** GET /api/s/{setId}/availability (cross-mirror shape); only the fields we act on. */
export const hinaiAvailabilitySchema = z.object({
  id: z.number().int(),
  availability: z.object({
    download_disabled: z.boolean().nullable(),
    more_information: z.string().nullable(),
  }),
});
