import { useMutation, useQueryClient } from '@tanstack/react-query';
import { okResponseSchema } from '@coldemail/shared';
import { apiFetch } from '../client';

export function useAckAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (alertId: number) =>
      apiFetch(`/alerts/${alertId}/ack`, okResponseSchema, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['alerts'] }),
  });
}
export function useAckAllAlerts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (throughId: number) =>
      apiFetch('/alerts/ack-all', okResponseSchema, {
        method: 'POST',
        body: { through_id: throughId },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['alerts'] }),
  });
}
