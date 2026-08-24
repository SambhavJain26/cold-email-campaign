import { useQuery } from '@tanstack/react-query';
import { alertsListResponseSchema } from '@coldemail/shared';
import { apiFetch } from '../client';
import { POLL } from '../queryClient';

export function useAlerts(unackedOnly = true, page = 1, perPage = 50) {
  return useQuery({
    queryKey: ['alerts', unackedOnly, page, perPage],
    queryFn: () =>
      apiFetch('/alerts', alertsListResponseSchema, {
        query: { unacked: unackedOnly ? 'true' : undefined, page, per_page: perPage },
      }),
    refetchInterval: POLL.alerts,
  });
}
