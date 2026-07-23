import type { FastifyError, FastifyInstance } from 'fastify';
import { CsvContractError, ImportTooLargeError } from '../../ingest/parse';
import { SequenceEditConflictError } from '../../db/repos/sequencesRepo';
import { AppError, toEnvelope } from '../errors';
import { RequestValidationError } from './zodCompilers';

/**
 * Central error mapping (docs/02 §6): AppError → its envelope; zod request
 * validation → 400 validation; everything else → 500 internal, logged with
 * stack, never leaked to the client (a ResponseContractViolationError lands
 * here deliberately — a response that breaks the contract is a bug, not a
 * client error). 404s use the envelope too.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send(toEnvelope(err.code, err.message, err.details));
    }
    if (err instanceof RequestValidationError) {
      return reply.status(400).send(
        toEnvelope(
          'validation',
          'Request validation failed',
          err.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
        ),
      );
    }
    // typed service errors → their contract codes (docs/10 error table)
    if (err instanceof ImportTooLargeError) {
      return reply.status(413).send(toEnvelope('import_too_large', err.message));
    }
    if (err instanceof CsvContractError) {
      return reply.status(400).send(toEnvelope('validation', err.message));
    }
    if (err instanceof SequenceEditConflictError) {
      return reply
        .status(422)
        .send(toEnvelope('sequence_invalid', err.message, { conflicts: err.details }));
    }
    const fastifyErr = err as Partial<FastifyError>;
    if (fastifyErr.validation) {
      return reply
        .status(400)
        .send(
          toEnvelope(
            'validation',
            fastifyErr.message ?? 'Validation failed',
            fastifyErr.validation,
          ),
        );
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send(toEnvelope('internal', 'Internal server error'));
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send(toEnvelope('not_found', `Route ${req.method} ${req.url} not found`));
  });
}
