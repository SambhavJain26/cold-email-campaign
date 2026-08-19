import { useMutation, useQueryClient } from '@tanstack/react-query';
import { campaignSchema, enrollResponseSchema, okResponseSchema } from '@coldemail/shared';
import { apiFetch } from '../client';
import { invalidateOperational } from '../operational-cache';

type EnrollBody =
  { count: number } | { lead_ids: number[]; force?: boolean; allow_recontact?: boolean };

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      sequence_id: number;
      tier_effort_config?: unknown;
      ramp_config?: unknown;
      acknowledge_tier_a_manual?: boolean;
    }) => apiFetch('/campaigns', campaignSchema, { method: 'POST', body }),
    onSuccess: () => invalidateOperational(qc),
  });
}

export function usePatchCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: number;
      body: { name?: string; status?: 'active' | 'paused' | 'archived' };
    }) => apiFetch(`/campaigns/${id}`, campaignSchema, { method: 'PATCH', body }),
    onSuccess: () => invalidateOperational(qc),
  });
}

export function useDeleteCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, confirm }: { id: number; confirm: string }) =>
      apiFetch(`/campaigns/${id}`, okResponseSchema, { method: 'DELETE', body: { confirm } }),
    onSuccess: () => invalidateOperational(qc),
  });
}

export function useEnroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ campaignId, body }: { campaignId: number; body: EnrollBody }) =>
      apiFetch(`/campaigns/${campaignId}/enroll`, enrollResponseSchema, {
        method: 'POST',
        body,
      }),
    onSuccess: () => invalidateOperational(qc),
  });
}

export function useRecycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      targetCampaignId,
      sourceCampaignId,
    }: {
      targetCampaignId: number;
      sourceCampaignId: number;
    }) =>
      apiFetch(`/campaigns/${targetCampaignId}/recycle`, enrollResponseSchema, {
        method: 'POST',
        body: { source_campaign_id: sourceCampaignId },
      }),
    onSuccess: () => invalidateOperational(qc),
  });
}

export function useDeactivateVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (variantId: number) =>
      apiFetch(`/step-variants/${variantId}/deactivate`, okResponseSchema, {
        method: 'POST',
      }),
    onSuccess: () => {
      invalidateOperational(qc);
      void qc.invalidateQueries({ queryKey: ['sequences'] });
    },
  });
}
