// Session-cookie auth on everything under /api/v1 except routes that declare
// `config: {public: true}` (only POST /auth/login — docs/10 header).
import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Route opts out of session auth (only POST /auth/login). */
    public?: boolean;
  }
}

export function registerRequireAuth(app: FastifyInstance): void {
  app.addHook('onRequest', async (req) => {
    if (req.routeOptions.config?.public) return;
    if (!req.session.get('email')) {
      throw new AppError('unauthorized', 401, 'Not authenticated');
    }
  });
}
