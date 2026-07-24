// Outbound alert webhook (B7.4, decision V): a generic JSON POST to
// ALERT_WEBHOOK_URL - the same shape works with Telegram/Slack/ntfy relays.
// Deliberately NOT SMTP self-mail: the mail path being broken is exactly when
// alerts matter most. Failure here must never break the emitting flow, so
// post() always resolves - network errors, non-2xx, and timeouts are swallowed
// (the alert is already durably in the `alerts` table by the time we POST).
import type { AlertWebhook } from './emitter';

export class HttpAlertWebhook implements AlertWebhook {
  constructor(
    private readonly url: string,
    private readonly timeoutMs = 5_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async post(payload: Record<string, unknown>): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch {
      // swallow - a broken alert channel must never break the emit (decision V)
    } finally {
      clearTimeout(timer);
    }
  }
}
