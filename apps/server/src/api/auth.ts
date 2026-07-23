// Auth route group (B6.1, docs/10 §Auth): login / logout / me /
// change-password against the single operator row (decision I).
import type { FastifyInstance } from 'fastify';
import {
  changePasswordBodySchema,
  loginBodySchema,
  meResponseSchema,
  okResponseSchema,
} from '@coldemail/shared';
import type { AppServices } from '../composition';
import { getOperator, updatePasswordHash } from '../db/repos/operatorRepo';
import { hashPassword, verifyPassword } from '../services/operatorAuth';
import { AppError } from './errors';
import { loginRateLimit } from './plugins/loginRateLimit';
import type { ZodTypeProvider } from './plugins/zodCompilers';

export async function authRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/auth/login',
    {
      config: { public: true },
      preHandler: loginRateLimit(services.clock),
      schema: { body: loginBodySchema, response: { 200: okResponseSchema } },
    },
    async (req) => {
      const op = await getOperator(services.db);
      if (
        !op ||
        op.email !== req.body.email ||
        !(await verifyPassword(op.passwordHash, req.body.password))
      ) {
        // One message for both wrong-email and wrong-password — no enumeration.
        throw new AppError('unauthorized', 401, 'Invalid email or password');
      }
      req.session.set('email', op.email);
      return { ok: true } as const;
    },
  );

  r.post('/auth/logout', { schema: { response: { 200: okResponseSchema } } }, async (req) => {
    req.session.delete();
    return { ok: true } as const;
  });

  r.get('/auth/me', { schema: { response: { 200: meResponseSchema } } }, async (req) => {
    const email = req.session.get('email');
    if (!email) throw new AppError('unauthorized', 401, 'Not authenticated');
    return { email };
  });

  r.post(
    '/auth/change-password',
    { schema: { body: changePasswordBodySchema, response: { 200: okResponseSchema } } },
    async (req) => {
      const op = await getOperator(services.db);
      if (!op || !(await verifyPassword(op.passwordHash, req.body.current))) {
        throw new AppError('unauthorized', 401, 'Current password is incorrect');
      }
      await updatePasswordHash(
        services.db,
        await hashPassword(req.body.next),
        services.clock.now(),
      );
      return { ok: true } as const;
    },
  );
}
