// B6.1 - auth routes + the /api/v1 middleware stack (session, CSRF header,
// rate limit, zod validation envelope).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiHarness, sessionCookieFrom, TEST_OPERATOR, type ApiHarness } from './helpers/app';

describe('B6.1 auth', () => {
  let h: ApiHarness;

  beforeAll(async () => {
    h = await createApiHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(() => {
    // Slide the login rate-limit window empty so tests don't interfere.
    h.clock.advance({ minutes: 2 });
  });

  const loginAttempt = (password: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-requested-with': 'fetch' },
      payload: { email: TEST_OPERATOR.email, password },
    });

  it('rejects a wrong password with 401 and the envelope (no enumeration)', async () => {
    const res = await loginAttempt('wrong-password');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: { code: 'unauthorized', message: 'Invalid email or password' },
    });
    // wrong email gets the identical message
    const res2 = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-requested-with': 'fetch' },
      payload: { email: 'nobody@test.dev', password: TEST_OPERATOR.password },
    });
    expect(res2.statusCode).toBe(401);
    expect(res2.json().error.message).toBe('Invalid email or password');
  });

  it('logs in and sets an HttpOnly SameSite=Strict session cookie', async () => {
    const res = await loginAttempt(TEST_OPERATOR.password);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toContain('session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).not.toContain('Secure'); // NODE_ENV=test
  });

  it('GET /auth/me without a session → 401 unauthorized', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });

  it('mutations without X-Requested-With: fetch → 403 forbidden (CSRF guard)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: TEST_OPERATOR.email, password: TEST_OPERATOR.password },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('forbidden');
  });

  it('schema violations → 400 validation with issue details', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-requested-with': 'fetch' },
      payload: { email: 'not-an-email', password: '' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('validation');
    expect(body.error.details.length).toBeGreaterThan(0);

    // .strict() rejects unknown keys - catches contract drift early
    const extra = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-requested-with': 'fetch' },
      payload: { email: TEST_OPERATOR.email, password: 'x', rememberMe: true },
    });
    expect(extra.statusCode).toBe(400);
    expect(extra.json().error.code).toBe('validation');
  });

  it('rate limits the 6th login attempt in a minute; the window slides', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await loginAttempt('wrong-password')).statusCode).toBe(401);
    }
    const sixth = await loginAttempt('wrong-password');
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error.code).toBe('rate_limited');

    h.clock.advance({ minutes: 1, seconds: 1 });
    expect((await loginAttempt('wrong-password')).statusCode).toBe(401);
  });

  it('me / logout / change-password roundtrip', async () => {
    const cookie = await h.login();

    const me = await h.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ email: TEST_OPERATOR.email });

    // change password (authed + CSRF header)
    const changed = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: { cookie, 'x-requested-with': 'fetch' },
      payload: { current: TEST_OPERATOR.password, next: 'a-brand-new-secret' },
    });
    expect(changed.statusCode).toBe(200);

    h.clock.advance({ minutes: 2 });
    expect((await loginAttempt(TEST_OPERATOR.password)).statusCode).toBe(401); // old is dead
    expect((await loginAttempt('a-brand-new-secret')).statusCode).toBe(200); // new works

    // wrong current password refuses the change
    const refused = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: { cookie, 'x-requested-with': 'fetch' },
      payload: { current: 'not-the-current', next: 'whatever-else-1' },
    });
    expect(refused.statusCode).toBe(401);

    // restore for any later suites in this file
    const restore = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: { cookie, 'x-requested-with': 'fetch' },
      payload: { current: 'a-brand-new-secret', next: TEST_OPERATOR.password },
    });
    expect(restore.statusCode).toBe(200);

    // logout kills the session
    const out = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie, 'x-requested-with': 'fetch' },
    });
    expect(out.statusCode).toBe(200);
    // logout clears the cookie - the cleared value no longer authenticates
    const after = await h.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: sessionCookieFrom(out) },
    });
    expect(after.statusCode).toBe(401);
  });

  it('session cookie survives across requests (7-day sealed session)', async () => {
    const cookie = await h.login();
    for (let i = 0; i < 3; i++) {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
    }
  });
});
