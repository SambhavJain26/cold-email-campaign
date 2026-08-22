// F0.2 — the ONE fetch wrapper (docs/11 §1). Every server call goes through
// apiFetch: /api/v1 base, credentials included, the CSRF header on all
// mutations (B6.1), error-envelope → AppApiError, responses zod-parsed with
// the shared contract schema (decision H — a shape drift fails loudly here).
import type { z } from 'zod';
import { errorEnvelopeSchema, type ApiErrorCode } from '@coldemail/shared';

export class AppApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppApiError';
  }
}

/** 401 anywhere → redirect /login (docs/11 §2) — the router registers the handler. */
let onUnauthorized: (() => void) | undefined;
export function setOnUnauthorized(handler: () => void): void {
  onUnauthorized = handler;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiFetchOptions {
  method?: Method;
  /** JSON body, or FormData for multipart (POST /imports). */
  body?: unknown;
  /** Query params — undefined values are dropped. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Suppress the central 401 redirect (the auth guard handles /auth/me itself). */
  skipUnauthorizedHandler?: boolean;
}

const appBase = import.meta.env.BASE_URL === '/' ? '' : import.meta.env.BASE_URL.replace(/\/$/, '');
export const API_BASE = `${appBase}/api/v1`;

export async function apiFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { method = 'GET', body, query, skipUnauthorizedHandler = false } = options;

  const params = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value));
    }
  }
  const qs = params.size > 0 ? `?${params.toString()}` : '';

  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['X-Requested-With'] = 'fetch'; // CSRF (B6.1) — ALL mutations
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE}${path}${qs}`, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });

  if (!res.ok) {
    let error: AppApiError;
    try {
      const envelope = errorEnvelopeSchema.parse(await res.json());
      error = new AppApiError(
        envelope.error.code,
        envelope.error.message,
        res.status,
        envelope.error.details,
      );
    } catch {
      error = new AppApiError('internal', `HTTP ${res.status}`, res.status);
    }
    if (res.status === 401 && !skipUnauthorizedHandler) onUnauthorized?.();
    throw error;
  }

  return schema.parse(await res.json());
}
