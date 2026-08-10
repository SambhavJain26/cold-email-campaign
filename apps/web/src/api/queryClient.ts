// F0.3 — server-state conventions (decision T, docs/11 §3).
// Poll intervals: overview 30s · unibox 60s · mailboxes 60s · alerts 30s ·
// everything else refetchOnWindowFocus only (the default below).
import { MutationCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AppApiError } from './client';

export const POLL = {
  operational: 30_000,
  overview: 30_000,
  unibox: 30_000,
  mailboxes: 30_000,
  alerts: 30_000,
} as const;

export const queryClient = new QueryClient({
  // F1.4 convention (docs/11 §3): every mutation failure surfaces the
  // envelope's message as a toast — screens add per-case handling on top.
  mutationCache: new MutationCache({
    onError: (error) => {
      toast.error(error instanceof AppApiError ? error.message : 'Request failed');
    },
  }),
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
