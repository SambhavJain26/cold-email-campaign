// Error envelope contract (decision Z / docs/10): closed code set,
// {"error":{"code","message","details?"}}. Thrown anywhere, mapped centrally
// by the errorHandler plugin. Formalized as a Zod schema in packages/shared at B6.

export const ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'not_found',
  'validation',
  'conflict',
  'rate_limited',
  'capacity_exceeded',
  'recycle_sequence_conflict',
  'import_too_large',
  'mailbox_unhealthy',
  'sequence_invalid',
  'internal',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly statusCode: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static notFound(what: string): AppError {
    return new AppError('not_found', 404, `${what} not found`);
  }
}

export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export function toEnvelope(code: ErrorCode, message: string, details?: unknown): ErrorEnvelope {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}
