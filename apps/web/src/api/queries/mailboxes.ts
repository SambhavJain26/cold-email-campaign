import { useQuery } from '@tanstack/react-query';
import {
  mailboxFoldersResponseSchema,
  mailboxListResponseSchema,
  mailboxVolumeResponseSchema,
} from '@coldemail/shared';
import { apiFetch } from '../client';
import { POLL } from '../queryClient';

export function useMailboxes() {
  return useQuery({
    queryKey: ['mailboxes'],
    queryFn: () => apiFetch('/mailboxes', mailboxListResponseSchema),
    refetchInterval: POLL.mailboxes,
  });
}

export function useMailboxFolders(mailboxId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: ['mailboxes', mailboxId, 'folders'],
    queryFn: () => apiFetch(`/mailboxes/${mailboxId}/folders`, mailboxFoldersResponseSchema),
    enabled: enabled && mailboxId !== undefined,
    staleTime: 5 * 60_000,
  });
}

export function useMailboxVolume(days = 30) {
  return useQuery({
    queryKey: ['mailboxes', 'volume', days],
    queryFn: () => apiFetch('/mailboxes/volume', mailboxVolumeResponseSchema, { query: { days } }),
    refetchInterval: POLL.operational,
  });
}
