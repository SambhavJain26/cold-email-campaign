// Cross-cutting contract vocabulary (docs/10 header + decision Z).
// These schemas ARE the executable contract (decision H): the server validates
// requests and responses with them; the web app infers its types from them.
// A contract change edits docs/10 and this package in the same commit.
import { z } from 'zod';

/** Closed error-code set (decision Z). Locked to apps/server/src/api/errors.ts by a unit test. */
export const API_ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'not_found',
  'validation',
  'conflict',
  'rate_limited',
  'capacity_exceeded',
  'recycle_sequence_conflict',
  'import_too_large',
  'mailbox_unhealthy',
  'sequence_invalid',
  'internal',
] as const;

export const errorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof errorCodeSchema>;

export const errorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: errorCodeSchema,
        message: z.string(),
        details: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();
export type ErrorEnvelopeDto = z.infer<typeof errorEnvelopeSchema>;

/** `?page=1&per_page=50` (default 50, max 200). */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

/** Every list response: `{items, total, page, per_page}`. */
export function listOf<T extends z.ZodType>(item: T) {
  return z
    .object({
      items: z.array(item),
      total: z.number().int().min(0),
      page: z.number().int().min(1),
      per_page: z.number().int().min(1),
    })
    .strict();
}

/** Metric = {numerator, denominator, value} (docs/05 §2). */
export const metricSchema = z
  .object({
    numerator: z.number(),
    denominator: z.number().nullable(),
    value: z.number(),
  })
  .strict();
export type MetricDto = z.infer<typeof metricSchema>;

/** Timestamps: ISO-8601 UTC strings (decision K). */
export const isoDateTime = z.iso.datetime();

/** Numeric path id (decision J — bigint identity, exposed as numbers). */
export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const okResponseSchema = z.object({ ok: z.literal(true) }).strict();
