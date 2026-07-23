// Session cookie (decision I): @fastify/secure-session - sodium-sealed,
// HttpOnly, SameSite=Strict, Secure in prod. Keyed by SESSION_KEY (32-byte
// hex). TTL 7 days (convention adopted 2026-07-23; decision I leaves it open).
import fastifySecureSession from '@fastify/secure-session';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../../config/env';

declare module '@fastify/secure-session' {
  interface SessionData {
    email: string;
  }
}

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function registerSession(app: FastifyInstance, config: Config): Promise<void> {
  await app.register(fastifySecureSession, {
    key: Buffer.from(config.SESSION_KEY, 'hex'),
    expiry: SESSION_TTL_SECONDS,
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: config.NODE_ENV === 'production',
    },
  });
}
