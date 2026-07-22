// The real alert emitter (B3.15, docs/02 §6): every alert is an `alerts` row;
// the optional outbound webhook (decision V, ALERT_WEBHOOK_URL) is wired at
// B7.4 — the seam is here so nothing else changes then.
import type { AlertSeverity } from '@coldemail/shared';
import type { Db } from '../db/client';
import { insertAlert } from '../db/repos/alertsRepo';
import type { AlertKind, AlertSink } from './types';

export interface AlertWebhook {
  /** Fire-and-forget; failures must never break the emitting flow. */
  post(payload: Record<string, unknown>): Promise<void>;
}

export class DbAlertSink implements AlertSink {
  constructor(
    private readonly db: Db,
    private readonly webhook?: AlertWebhook, // B7.4
  ) {}

  async emit(
    kind: AlertKind,
    severity: AlertSeverity,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await insertAlert(this.db, kind, severity, payload);
    if (this.webhook) {
      void this.webhook.post({ kind, severity, ...payload }).catch(() => {
        /* webhook failure is never fatal — decision V */
      });
    }
  }
}
