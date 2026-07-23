import { useQuery } from '@tanstack/react-query';
import { mailboxListResponseSchema, mailboxVolumeResponseSchema } from '@coldemail/shared';
import { apiFetch } from '../client';
import { POLL } from '../queryClient';

export function useMailboxes() {
  return useQuery({
    queryKey: ['mailboxes'],
    queryFn: () => apiFetch('/mailboxes', mailboxListResponseSchema),
    refetchInterval: POLL.mailboxes,
  });
}

export function useMailboxVolume(days = 30) {
  return useQuery({
    queryKey: ['mailboxes', 'volume', days],
    queryFn: () => apiFetch('/mailboxes/volume', mailboxVolumeResponseSchema, { query: { days } }),
  });
}
