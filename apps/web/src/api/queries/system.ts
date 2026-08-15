import { useQuery } from '@tanstack/react-query';
import {
  incomingMessagesResponseSchema,
  preflightResponseSchema,
  systemStatusResponseSchema,
} from '@coldemail/shared';
import { apiFetch } from '../client';
import { POLL } from '../queryClient';

/**
 * Domain-readiness preflight. Not polled — it does live DNS lookups, and the
 * answer only changes when the operator changes DNS or settings.
 */
export function usePreflight() {
  return useQuery({
    queryKey: ['system', 'preflight'],
    queryFn: () => apiFetch('/system/preflight', preflightResponseSchema),
    staleTime: Infinity,
  });
}

export function useSystemStatus() {
  return useQuery({
    queryKey: ['system', 'status'],
    queryFn: () => apiFetch('/system/status', systemStatusResponseSchema),
    refetchInterval: POLL.operational,
  });
}

export interface IncomingMessagesQuery {
  page?: number;
  per_page?: number;
  classification?: 'bounce' | 'auto_reply' | 'human_reply' | 'unrelated';
  mailbox_id?: number;
}

export function useIncomingMessages(query: IncomingMessagesQuery = {}) {
  return useQuery({
    queryKey: ['system', 'incoming-messages', query],
    queryFn: () =>
      apiFetch('/incoming-messages', incomingMessagesResponseSchema, { query: { ...query } }),
    refetchInterval: POLL.operational,
  });
}
