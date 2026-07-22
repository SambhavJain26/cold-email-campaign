import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError, toEnvelope } from '../errors';

/**
 * Central error mapping (docs/02 §6): AppError → its envelope; Fastify
 * validation errors → 400 validation; everything else → 500 internal,
 * logged with stack, never leaked to the client. 404s use the envelope too.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send(toEnvelope(err.code, err.message, err.details));
    }
    const fastifyErr = err as Partial<FastifyError>;
    if (fastifyErr.validation) {
      return reply
        .status(400)
        .send(toEnvelope('validation', fastifyErr.message ?? 'Validation failed', fastifyErr.validation));
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send(toEnvelope('internal', 'Internal server error'));
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send(toEnvelope('not_found', `Route ${req.method} ${req.url} not found`));
  });
}
