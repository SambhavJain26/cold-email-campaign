// F0.3 — server-state conventions (decision T, docs/11 §3).
// Poll intervals: overview 30s · unibox 60s · mailboxes 60s · alerts 30s ·
// everything else refetchOnWindowFocus only (the default below).
import { QueryClient } from '@tanstack/react-query';
import { AppApiError } from './client';

export const POLL = {
  overview: 30_000,
  unibox: 60_000,
  mailboxes: 60_000,
  alerts: 30_000,
} as const;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // Never retry contract-level failures (4xx) — only network/5xx, once.
        if (error instanceof AppApiError && error.status < 500) return false;
        return failureCount < 1;
      },
    },
  },
});
