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
  | 'job_failed';

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
