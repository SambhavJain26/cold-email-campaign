import { useMutation, useQueryClient } from '@tanstack/react-query';
import { okResponseSchema } from '@coldemail/shared';
import { apiFetch } from '../client';

export function useAckAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (alertId: number) =>
      apiFetch(`/alerts/${alertId}/ack`, okResponseSchema, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });
}
