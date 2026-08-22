import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getOauthCredential } from '../../src/db/repos/mailboxOauthRepo';
import { getMailbox } from '../../src/db/repos/mailboxesRepo';
import { createApiHarness, type ApiHarness } from './helpers/app';

const OAUTH_MAILBOX = {
  display_name: 'Workspace Sender',
  from_address: 'sender@sambhavpmtech.com',
  auth_type: 'google_oauth' as const,
  daily_cap: 5,
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Google OAuth mailbox flow', () => {
  let h: ApiHarness;
  let responses: Response[];
  const fetchMock = vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit) =>
      responses.shift() ?? json({ error: 'unexpected request' }, 500),
  );

  beforeAll(async () => {
    vi.stubGlobal('fetch', fetchMock);
    h = await createApiHarness(
      {},
      {
        PUBLIC_APP_URL: 'https://sambhavpmtech.com/email-campaign',
        GOOGLE_OAUTH_CLIENT_ID: 'test-client-id',
        GOOGLE_OAUTH_CLIENT_SECRET: 'test-client-secret',
      },
    );
  });

  beforeEach(async () => {
    await h.reset();
    responses = [];
    fetchMock.mockClear();
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await h.close();
  });

  async function createAndStart(): Promise<{ mailboxId: number; state: string }> {
    const created = await h.inject({
      method: 'POST',
      url: '/api/v1/mailboxes',
      payload: OAUTH_MAILBOX,
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      auth_type: 'google_oauth',
      oauth_connected: false,
      status: 'setup_required',
      smtp_host: 'smtp.gmail.com',
      imap_host: 'imap.gmail.com',
    });
    const mailboxId = created.json().id as number;
    const started = await h.inject({
      method: 'POST',
      url: `/api/v1/mailboxes/${mailboxId}/oauth/google/start`,
    });
    expect(started.statusCode).toBe(200);
    const authorization = new URL(started.json().authorization_url as string);
    expect(authorization.searchParams.get('redirect_uri')).toBe(
      'https://sambhavpmtech.com/email-campaign/oauth/google/callback',
    );
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('access_type')).toBe('offline');
    return { mailboxId, state: authorization.searchParams.get('state')! };
  }

  it('rejects expired state before contacting Google', async () => {
    const { state } = await createAndStart();
    await h.pool.query("UPDATE mailbox_oauth_states SET expires_at = '2000-01-01T00:00:00Z'");
    const callback = await h.app.inject({
      method: 'GET',
      url: `/oauth/google/callback?code=unused&state=${encodeURIComponent(state)}`,
    });
    expect(callback.headers.location).toBe(
      'https://sambhavpmtech.com/email-campaign/mailboxes?oauth=error',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stores a sealed refresh credential, prevents replay, refreshes, and revokes', async () => {
    const { mailboxId, state } = await createAndStart();
    responses.push(
      json({
        access_token: 'initial-access',
        refresh_token: 'durable-refresh',
        expires_in: 3600,
        scope: 'openid email https://mail.google.com/',
      }),
      json({ email: OAUTH_MAILBOX.from_address, email_verified: true }),
    );
    const callbackUrl = `/oauth/google/callback?code=one-time-code&state=${encodeURIComponent(state)}`;
    const callback = await h.app.inject({ method: 'GET', url: callbackUrl });
    expect(callback.headers.location).toBe(
      'https://sambhavpmtech.com/email-campaign/mailboxes?oauth=connected',
    );
    const credential = await getOauthCredential(h.services.db, mailboxId);
    expect(credential).not.toBeNull();
    expect(credential!.sealedRefreshToken.toString('utf8')).not.toContain('durable-refresh');
    expect((await getMailbox(h.services.db, mailboxId))!.status).toBe('ok');

    const replay = await h.app.inject({ method: 'GET', url: callbackUrl });
    expect(replay.headers.location).toContain('oauth=error');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Drop the memory-only access token so Test Connection must exercise the
    // encrypted refresh credential and Google token refresh endpoint.
    const service = h.services.googleOAuth as unknown as {
      accessTokens: Map<number, unknown>;
    };
    service.accessTokens.clear();
    responses.push(json({ access_token: 'refreshed-access', expires_in: 3600 }));
    const tested = await h.inject({
      method: 'POST',
      url: `/api/v1/mailboxes/${mailboxId}/test-connection`,
    });
    expect(tested.statusCode).toBe(200);
    expect(tested.json()).toMatchObject({ smtp_ok: true, imap_ok: true });

    responses.push(json({}));
    const disconnected = await h.inject({
      method: 'POST',
      url: `/api/v1/mailboxes/${mailboxId}/oauth/google/disconnect`,
    });
    expect(disconnected.statusCode).toBe(200);
    expect(await getOauthCredential(h.services.db, mailboxId)).toBeNull();
    expect((await getMailbox(h.services.db, mailboxId))!.status).toBe('setup_required');
    const revokeCall = fetchMock.mock.calls.at(-1)!;
    expect(String(revokeCall[0])).toBe('https://oauth2.googleapis.com/revoke');
    expect(String((revokeCall[1] as RequestInit).body)).toContain('token=durable-refresh');
  });

  it('rejects an authorization for a different Google account', async () => {
    const { mailboxId, state } = await createAndStart();
    responses.push(
      json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }),
      json({ email: 'someone-else@sambhavpmtech.com', email_verified: true }),
    );
    const callback = await h.app.inject({
      method: 'GET',
      url: `/oauth/google/callback?code=code&state=${encodeURIComponent(state)}`,
    });
    expect(callback.headers.location).toContain('oauth=error');
    expect(await getOauthCredential(h.services.db, mailboxId)).toBeNull();
    expect((await getMailbox(h.services.db, mailboxId))!.status).toBe('setup_required');
  });

  it('refuses a token exchange that omits the required refresh token', async () => {
    const { mailboxId, state } = await createAndStart();
    responses.push(json({ access_token: 'access-only', expires_in: 3600 }));
    const callback = await h.app.inject({
      method: 'GET',
      url: `/oauth/google/callback?code=code&state=${encodeURIComponent(state)}`,
    });
    expect(callback.headers.location).toContain('oauth=error');
    expect(await getOauthCredential(h.services.db, mailboxId)).toBeNull();
  });
});
