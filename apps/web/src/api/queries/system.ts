import { useQuery } from '@tanstack/react-query';
import { incomingMessagesResponseSchema, systemStatusResponseSchema } from '@coldemail/shared';
import { apiFetch } from '../client';
import { POLL } from '../queryClient';

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
