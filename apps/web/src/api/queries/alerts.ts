import { useQuery } from '@tanstack/react-query';
import { alertsListResponseSchema } from '@coldemail/shared';
import { apiFetch } from '../client';
import { POLL } from '../queryClient';

export function useAlerts(unackedOnly = true) {
  return useQuery({
    queryKey: ['alerts', unackedOnly],
    queryFn: () =>
      apiFetch('/alerts', alertsListResponseSchema, {
        query: { unacked: unackedOnly ? 'true' : undefined },
      }),
    refetchInterval: POLL.alerts,
  });
}
