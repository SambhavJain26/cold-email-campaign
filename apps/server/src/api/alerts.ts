// Alert feed route group (B6.11, docs/10, decision V) — the banners poll this.
import type { FastifyInstance } from 'fastify';
import {
  alertsListResponseSchema,
  alertsQuerySchema,
  idParamSchema,
  okResponseSchema,
  type AlertDto,
} from '@coldemail/shared';
import type { AppServices } from '../composition';
import { acknowledgeAlert, getAlert, listAlerts, type AlertRow } from '../db/repos/alertsRepo';
import { AppError } from './errors';
import type { ZodTypeProvider } from './plugins/zodCompilers';

function toAlertDto(row: AlertRow): AlertDto {
  return {
    id: row.id,
    kind: row.kind,
    severity: row.severity,
    payload: row.payload as Record<string, unknown>,
    created_at: row.createdAt.toISOString(),
    acknowledged_at: row.acknowledgedAt?.toISOString() ?? null,
  };
}

export async function alertsRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db, clock } = services;

  r.get(
    '/alerts',
    { schema: { querystring: alertsQuerySchema, response: { 200: alertsListResponseSchema } } },
    async (req) => {
      const { page, per_page, unacked } = req.query;
      const { items, total } = await listAlerts(db, { unacked, page, perPage: per_page });
      return { items: items.map(toAlertDto), total, page, per_page };
    },
  );

  r.post(
    '/alerts/:id/ack',
    { schema: { params: idParamSchema, response: { 200: okResponseSchema } } },
    async (req) => {
      const alert = await getAlert(db, req.params.id);
      if (!alert) throw AppError.notFound('alert');
      await acknowledgeAlert(db, req.params.id, clock.now());
      return { ok: true } as const;
    },
  );
}
