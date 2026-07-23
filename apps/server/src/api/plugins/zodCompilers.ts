// Decision H wiring: routes declare the SHARED Zod schemas (packages/shared/
// src/api) for body/query/params AND responses. Requests are parsed (coerced,
// stripped, typed) before handlers run; responses are re-validated at
// serialization time — a contract-violating response is a 500, never silently
// shipped. This replaces Fastify's ajv pipeline; no type-provider dependency.
import type { FastifyInstance, FastifyTypeProvider } from 'fastify';
import type { z } from 'zod';

/** Typed request.body/query/params + response inference from zod schemas. */
export interface ZodTypeProvider extends FastifyTypeProvider {
  validator: this['schema'] extends z.ZodType ? z.output<this['schema']> : unknown;
  serializer: this['schema'] extends z.ZodType ? z.input<this['schema']> : unknown;
}

/**
 * A request failed its schema → mapped to the 400 `validation` envelope by
 * the errorHandler. (Zod 4's ZodError does not extend Error, so Fastify's
 * built-in `.validation` wrapping never applies — we throw our own class.)
 */
export class RequestValidationError extends Error {
  constructor(readonly issues: z.ZodIssue[]) {
    super('Request validation failed');
    this.name = 'RequestValidationError';
  }
}

/** A response violated the contract schema → 500 `internal`, logged loudly. */
export class ResponseContractViolationError extends Error {
  constructor(readonly issues: z.ZodIssue[]) {
    super('Response violated the API contract schema');
    this.name = 'ResponseContractViolationError';
  }
}

export function registerZodCompilers(app: FastifyInstance): void {
  app.setValidatorCompiler<z.ZodType>(({ schema }) => (data) => {
    const result = schema.safeParse(data);
    if (result.success) return { value: result.data };
    return { error: new RequestValidationError(result.error.issues) };
  });

  app.setSerializerCompiler<z.ZodType>(({ schema }) => (data) => {
    const result = schema.safeParse(data);
    if (result.success) return JSON.stringify(result.data);
    throw new ResponseContractViolationError(result.error.issues);
  });
}
