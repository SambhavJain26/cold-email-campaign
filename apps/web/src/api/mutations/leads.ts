import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  bulkTierResponseSchema,
  leadSchema,
  okResponseSchema,
  type BulkTierBody,
  type PatchLeadBody,
} from '@coldemail/shared';
import { apiFetch } from '../client';

export function usePatchLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: PatchLeadBody }) =>
      apiFetch(`/leads/${id}`, leadSchema, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

export function useBulkTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkTierBody) =>
      apiFetch('/leads/bulk-tier', bulkTierResponseSchema, { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

/** Decision U: typed-confirm un-suppression — confirm must equal the email. */
export function useRemoveSuppression() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, confirm }: { email: string; confirm: string }) =>
      apiFetch(`/suppressions/${encodeURIComponent(email)}`, okResponseSchema, {
        method: 'DELETE',
        body: { confirm },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
}
