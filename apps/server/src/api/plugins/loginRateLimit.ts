// Login rate limit (decision I): 5 attempts/min/IP, in-memory sliding window.
// Hand-rolled instead of @fastify/rate-limit so it reads services.clock —
// VirtualClock can drive the window in tests. Single-process app (docs/02),
// so process-local state is the whole truth.
import type { preHandlerAsyncHookHandler } from 'fastify';
import type { Clock } from '../../clock';
import { AppError } from '../errors';

export function loginRateLimit(
  clock: Clock,
  limit = 5,
  windowMs = 60_000,
): preHandlerAsyncHookHandler {
  const attempts = new Map<string, number[]>();
  return async (req) => {
    const now = clock.now().getTime();
    const recent = (attempts.get(req.ip) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      attempts.set(req.ip, recent);
      throw new AppError('rate_limited', 429, 'Too many login attempts — wait a minute');
    }
    recent.push(now);
    attempts.set(req.ip, recent);
  };
}
