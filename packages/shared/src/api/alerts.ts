// Alert feed (docs/10 §Settings…, decision V) — banners poll GET /alerts.
import { z } from 'zod';
import { ALERT_SEVERITIES } from '../domain/index';
import { isoDateTime, listOf, pageQuerySchema } from './common';

export const alertSchema = z
  .object({
    id: z.number().int(),
    kind: z.string(),
    severity: z.enum(ALERT_SEVERITIES),
    payload: z.record(z.string(), z.unknown()),
    created_at: isoDateTime,
    acknowledged_at: isoDateTime.nullable(),
  })
  .strict();
export type AlertDto = z.infer<typeof alertSchema>;

export const alertsQuerySchema = pageQuerySchema.extend({
  unacked: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const alertsListResponseSchema = listOf(alertSchema).extend({
  ack_through_id: z.number().int().nonnegative().optional(),
});
export const acknowledgeAllAlertsSchema = z
  .object({ through_id: z.number().int().nonnegative() })
  .strict();
