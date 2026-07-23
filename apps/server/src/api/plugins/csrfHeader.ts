// CSRF belt-and-braces (decision I): every mutating request must carry
// `X-Requested-With: fetch` — a custom header a cross-site form can't set.
// Applies to login too (closes login-CSRF; adopted 2026-07-23).
import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function registerCsrfHeader(app: FastifyInstance): void {
  app.addHook('onRequest', async (req) => {
    if (!MUTATING.has(req.method)) return;
    if (req.headers['x-requested-with'] !== 'fetch') {
      throw new AppError('forbidden', 403, 'Missing X-Requested-With: fetch header');
    }
  });
}
