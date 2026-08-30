// Alert seam (docs/02 §6). The real emitter (alerts table + optional
// webhook) lands at B3.15; until then callers depend on this interface and
// tests can capture emissions.
import type { AlertSeverity } from '@coldemail/shared';

export type AlertKind =
  | 'mailbox_auto_paused'
  | 'mailbox_auth_failed'
  | 'mailbox_smtp_failing'
  | 'imap_stale'
  | 'imap_recovered'
  | 'provider_blocked'
  | 'selfcheck_drift'
  | 'catchup_backlog'
  | 'suppression_removed'
  | 'job_failed'
  | 'compliance_missing_address' // docs/08 §4 global send guard (B4.8)
  | 'send_blocked_compliance_missing_address'
  | 'send_blocked_no_healthy_mailbox'
  | 'send_blocked_send_window_closed'
  | 'send_blocked_daily_capacity_exhausted'
  | 'send_blocked_pacing_delay'
  | 'send_blocked_manual_only'
  | 'render_failed' // fatal pre-send check blocked a send (B4.8)
  | 'personalized_copy_blocked';

export interface AlertSink {
  emit(kind: AlertKind, severity: AlertSeverity, payload: Record<string, unknown>): Promise<void>;
}

/** Default no-op sink for stages before B3.15 wires the real emitter. */
export const nullAlerts: AlertSink = {
  emit: () => Promise.resolve(),
};

/** Test helper shape: an AlertSink that records everything. */
export class CapturingAlerts implements AlertSink {
  readonly emitted: {
    kind: AlertKind;
    severity: AlertSeverity;
    payload: Record<string, unknown>;
  }[] = [];
  emit(kind: AlertKind, severity: AlertSeverity, payload: Record<string, unknown>): Promise<void> {
    this.emitted.push({ kind, severity, payload });
    return Promise.resolve();
  }
}
