import { useQuery } from '@tanstack/react-query';
import { uniboxDetailResponseSchema, uniboxListResponseSchema } from '@coldemail/shared';
import { apiFetch } from '../client';
import { POLL } from '../queryClient';

export interface UniboxQuery {
  page?: number;
  per_page?: number;
  bucket?: 'human' | 'auto_reply';
  sentiment?: 'positive' | 'neutral' | 'negative';
  mailbox_id?: number;
  unhandled?: boolean;
}

export function useUnibox(query: UniboxQuery = {}) {
  return useQuery({
    queryKey: ['unibox', query],
    queryFn: () => apiFetch('/unibox', uniboxListResponseSchema, { query: { ...query } }),
    refetchInterval: POLL.unibox,
  });
}

export function useUniboxItem(incomingMessageId: number) {
  return useQuery({
    queryKey: ['unibox', 'detail', incomingMessageId],
    queryFn: () => apiFetch(`/unibox/${incomingMessageId}`, uniboxDetailResponseSchema),
    refetchInterval: POLL.operational,
  });
}
