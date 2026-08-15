import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  bulkTierResponseSchema,
  createLeadResponseSchema,
  leadSchema,
  okResponseSchema,
  type BulkTierBody,
  type CreateLeadBody,
  type PatchLeadBody,
} from '@coldemail/shared';
import { apiFetch } from '../client';
import { invalidateOperational } from '../operational-cache';

/**
 * Finding 10. A refusal is a 200 with `created:false`, not an error — the row
 * being rejected by hygiene is a normal outcome the caller must render, so
 * the global mutation error toast must NOT fire for it.
 */
export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLeadBody) =>
      apiFetch('/leads', createLeadResponseSchema, { method: 'POST', body }),
    onSuccess: () => invalidateOperational(qc),
  });
}

export function usePatchLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: PatchLeadBody }) =>
      apiFetch(`/leads/${id}`, leadSchema, { method: 'PATCH', body }),
    onSuccess: () => invalidateOperational(qc),
  });
}

export function useBulkTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkTierBody) =>
      apiFetch('/leads/bulk-tier', bulkTierResponseSchema, { method: 'POST', body }),
    onSuccess: () => invalidateOperational(qc),
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
    onSuccess: () => invalidateOperational(qc),
  });
}

/** Irreversible PII anonymization.  The append-only event lineage remains. */
export function useEraseLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, confirm }: { id: number; confirm: string }) =>
      apiFetch(`/leads/${id}/erase`, okResponseSchema, { method: 'POST', body: { confirm } }),
    onSuccess: () => invalidateOperational(qc),
  });
}
