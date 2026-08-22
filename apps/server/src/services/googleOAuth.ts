import { createHash, randomBytes } from 'node:crypto';
import type { Clock } from '../clock';
import type { Config } from '../config/env';
import type { Db } from '../db/client';
import {
  consumeOauthState,
  deleteOauthCredential,
  getOauthCredential,
  insertOauthState,
  upsertOauthCredential,
} from '../db/repos/mailboxOauthRepo';
import { getMailbox, patchMailbox } from '../db/repos/mailboxesRepo';
import { sealSecret, unsealSecret } from '../secrets/seal';
import type { AlertSink } from '../alerts/types';
import { TransportAuthError } from '../transport/types';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const SCOPES = ['openid', 'email', 'https://mail.google.com/'] as const;
const STATE_TTL_MS = 10 * 60_000;

type FetchLike = typeof fetch;

interface CachedAccessToken {
  value: string;
  refreshAt: number;
}

export class GoogleOauthError extends Error {
  constructor(
    message: string,
    readonly publicCode:
      'not_configured' | 'invalid_state' | 'token_exchange_failed' | 'account_mismatch',
  ) {
    super(message);
    this.name = 'GoogleOauthError';
  }
}

export interface GoogleOAuthDeps {
  db: Db;
  clock: Clock;
  alerts: AlertSink;
  config: Pick<
    Config,
    'SECRET_KEY' | 'PUBLIC_APP_URL' | 'GOOGLE_OAUTH_CLIENT_ID' | 'GOOGLE_OAUTH_CLIENT_SECRET'
  >;
  fetchImpl?: FetchLike;
}

/** Authorization-code + PKCE service. Refresh credentials never leave this boundary. */
export class GoogleOAuthService {
  private readonly accessTokens = new Map<number, CachedAccessToken>();

  constructor(private readonly deps: GoogleOAuthDeps) {}

  get configured(): boolean {
    return Boolean(
      this.deps.config.GOOGLE_OAUTH_CLIENT_ID && this.deps.config.GOOGLE_OAUTH_CLIENT_SECRET,
    );
  }

  get callbackUrl(): string {
    return `${this.deps.config.PUBLIC_APP_URL.replace(/\/$/, '')}/oauth/google/callback`;
  }

  async authorizationUrl(mailboxId: number): Promise<string> {
    const { clientId } = this.requireConfig();
    const mailbox = await getMailbox(this.deps.db, mailboxId);
    if (!mailbox || mailbox.authType !== 'google_oauth') {
      throw new GoogleOauthError('Google OAuth mailbox not found', 'invalid_state');
    }

    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    await insertOauthState(this.deps.db, {
      stateHash: hashState(state),
      mailboxId,
      sealedCodeVerifier: await sealSecret(verifier, this.deps.config.SECRET_KEY),
      expiresAt: new Date(this.deps.clock.now().getTime() + STATE_TTL_MS),
    });

    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.callbackUrl,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      login_hint: mailbox.fromAddress,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  async completeAuthorization(state: string, code: string): Promise<number> {
    const { clientId, clientSecret } = this.requireConfig();
    const now = this.deps.clock.now();
    const pending = await consumeOauthState(this.deps.db, hashState(state), now);
    if (!pending) throw new GoogleOauthError('OAuth state is invalid or expired', 'invalid_state');
    const mailbox = await getMailbox(this.deps.db, pending.mailboxId);
    if (!mailbox || mailbox.authType !== 'google_oauth') {
      throw new GoogleOauthError('Google OAuth mailbox no longer exists', 'invalid_state');
    }

    const verifier = await unsealSecret(pending.sealedCodeVerifier, this.deps.config.SECRET_KEY);
    const token = await this.postForm(TOKEN_URL, {
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: this.callbackUrl,
    });
    const accessToken = stringField(token, 'access_token');
    const refreshToken = stringField(token, 'refresh_token');
    if (!accessToken || !refreshToken) {
      throw new GoogleOauthError(
        'Google did not return the required offline refresh credential',
        'token_exchange_failed',
      );
    }

    const userinfoResponse = await this.fetcher(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userinfoResponse.ok) {
      throw new GoogleOauthError('Could not verify the Google account', 'token_exchange_failed');
    }
    const userinfo = (await userinfoResponse.json()) as Record<string, unknown>;
    const grantedEmail = stringField(userinfo, 'email')?.trim().toLowerCase();
    if (
      !grantedEmail ||
      userinfo.email_verified !== true ||
      grantedEmail !== mailbox.fromAddress.trim().toLowerCase()
    ) {
      throw new GoogleOauthError(
        'The authorized Google account does not match the mailbox address',
        'account_mismatch',
      );
    }

    await upsertOauthCredential(this.deps.db, {
      mailboxId: mailbox.id,
      sealedRefreshToken: await sealSecret(refreshToken, this.deps.config.SECRET_KEY),
      grantedEmail,
      scopes: String(token.scope ?? SCOPES.join(' '))
        .split(/\s+/)
        .filter(Boolean),
      at: now,
    });
    this.cacheToken(mailbox.id, accessToken, numberField(token, 'expires_in'));
    await patchMailbox(this.deps.db, mailbox.id, {
      status: 'ok',
      statusReason: null,
      pausedAt: null,
    });
    return mailbox.id;
  }

  async accessToken(mailboxId: number): Promise<string> {
    const cached = this.accessTokens.get(mailboxId);
    if (cached && Date.now() < cached.refreshAt) return cached.value;
    const { clientId, clientSecret } = this.requireConfig();
    const credential = await getOauthCredential(this.deps.db, mailboxId);
    if (!credential) {
      await this.markAuthorizationFailed(mailboxId, 'Google authorization is missing');
      throw new TransportAuthError('Google authorization is missing; reconnect the mailbox');
    }
    const refreshToken = await unsealSecret(
      credential.sealedRefreshToken,
      this.deps.config.SECRET_KEY,
    );

    let token: Record<string, unknown>;
    try {
      token = await this.postForm(TOKEN_URL, {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      });
    } catch (err) {
      if (err instanceof GoogleOauthError) {
        await this.markAuthorizationFailed(
          mailboxId,
          'Google authorization was revoked or expired',
        );
        throw new TransportAuthError('Google authorization failed; reconnect the mailbox');
      }
      throw err;
    }
    const accessToken = stringField(token, 'access_token');
    if (!accessToken) {
      await this.markAuthorizationFailed(mailboxId, 'Google did not return an access token');
      throw new TransportAuthError('Google authorization failed; reconnect the mailbox');
    }
    this.cacheToken(mailboxId, accessToken, numberField(token, 'expires_in'));
    return accessToken;
  }

  async disconnect(mailboxId: number): Promise<void> {
    const credential = await getOauthCredential(this.deps.db, mailboxId);
    if (credential) {
      const refreshToken = await unsealSecret(
        credential.sealedRefreshToken,
        this.deps.config.SECRET_KEY,
      );
      await this.fetcher(REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshToken }),
      }).catch(() => undefined);
    }
    this.accessTokens.delete(mailboxId);
    await deleteOauthCredential(this.deps.db, mailboxId);
    await patchMailbox(this.deps.db, mailboxId, {
      status: 'setup_required',
      statusReason: 'Google authorization disconnected',
      pausedAt: this.deps.clock.now(),
    });
  }

  private async postForm(
    url: string,
    values: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const response = await this.fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values),
    });
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        throw new GoogleOauthError('Google token exchange was rejected', 'token_exchange_failed');
      }
      throw new Error(`Google token endpoint is temporarily unavailable (${response.status})`);
    }
    return (await response.json()) as Record<string, unknown>;
  }

  private async markAuthorizationFailed(mailboxId: number, reason: string): Promise<void> {
    this.accessTokens.delete(mailboxId);
    await patchMailbox(this.deps.db, mailboxId, {
      status: 'auth_failed',
      statusReason: reason,
      pausedAt: this.deps.clock.now(),
    });
    await this.deps.alerts.emit('mailbox_auth_failed', 'error', { mailboxId, error: reason });
  }

  private cacheToken(mailboxId: number, token: string, expiresIn?: number): void {
    const lifetimeMs = Math.max(60, expiresIn ?? 3600) * 1000;
    this.accessTokens.set(mailboxId, {
      value: token,
      refreshAt: Date.now() + Math.max(30_000, lifetimeMs - 5 * 60_000),
    });
  }

  private requireConfig(): { clientId: string; clientSecret: string } {
    const clientId = this.deps.config.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = this.deps.config.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new GoogleOauthError('Google OAuth is not configured', 'not_configured');
    }
    return { clientId, clientSecret };
  }

  private get fetcher(): FetchLike {
    return this.deps.fetchImpl ?? fetch;
  }
}

function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === 'string' ? value[key] : undefined;
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  return typeof value[key] === 'number' && Number.isFinite(value[key]) ? value[key] : undefined;
}
