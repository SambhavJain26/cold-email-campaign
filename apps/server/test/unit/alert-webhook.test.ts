// B7.4 — the outbound alert webhook (decision V). A generic JSON POST that
// must be fire-and-forget: post() always resolves, whatever the far end does.
import { describe, expect, it, vi } from 'vitest';
import { HttpAlertWebhook } from '../../src/alerts/webhook';

const URL = 'https://relay.example/alert';
const payload = { kind: 'selfcheck_drift', severity: 'error', check: 'invariants' };

describe('HttpAlertWebhook', () => {
  it('POSTs the payload as JSON to the configured URL', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    await new HttpAlertWebhook(URL, 5_000, fetchImpl as unknown as typeof fetch).post(payload);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  it('resolves (never throws) when the request rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(
      new HttpAlertWebhook(URL, 5_000, fetchImpl as unknown as typeof fetch).post(payload),
    ).resolves.toBeUndefined();
  });

  it('resolves on a non-2xx response (does not inspect status)', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
    await expect(
      new HttpAlertWebhook(URL, 5_000, fetchImpl as unknown as typeof fetch).post(payload),
    ).resolves.toBeUndefined();
  });

  it('aborts a hung request after the timeout without throwing', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    await expect(
      new HttpAlertWebhook(URL, 10, fetchImpl as unknown as typeof fetch).post(payload),
    ).resolves.toBeUndefined();
  });
});
