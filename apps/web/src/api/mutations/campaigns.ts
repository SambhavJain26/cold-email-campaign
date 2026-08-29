import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  campaignSchema,
  enrollResponseSchema,
  okResponseSchema,
  recycleCommitResponseSchema,
  recyclePreviewResponseSchema,
  type CreateCampaignBody,
  type PatchCampaignBody,
  poolMutationResponseSchema,
  patchAutoEnrollmentResponseSchema,
} from '@coldemail/shared';
import { apiFetch } from '../client';
import { invalidateOperational } from '../operational-cache';

type EnrollBody =
  { count: number } | { lead_ids: number[]; force?: boolean; allow_recontact?: boolean };

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCampaignBody) =>
      apiFetch('/campaigns', campaignSchema, { method: 'POST', body }),
    onSuccess: () => invalidateOperational(qc),
  });
}

export function usePatchCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: PatchCampaignBody }) =>
      apiFetch(`/campaigns/${id}`, campaignSchema, { method: 'PATCH', body }),
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
      sourceCampaignIds,
    }: {
      targetCampaignId: number;
      sourceCampaignIds: number[];
    }) =>
      apiFetch(`/campaigns/${targetCampaignId}/recycle`, recycleCommitResponseSchema, {
        method: 'POST',
        body: { source_campaign_ids: sourceCampaignIds },
      }),
    onSuccess: () => invalidateOperational(qc),
  });
}

export function useRecyclePreview() {
  return useMutation({
    mutationFn: ({
      targetCampaignId,
      sourceCampaignIds,
    }: {
      targetCampaignId: number;
      sourceCampaignIds: number[];
    }) =>
      apiFetch(`/campaigns/${targetCampaignId}/recycle/preview`, recyclePreviewResponseSchema, {
        method: 'POST',
        body: { source_campaign_ids: sourceCampaignIds },
      }),
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

export function useAddPoolLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      campaignId,
      count,
      sourceImportId,
    }: {
      campaignId: number;
      count: number;
      sourceImportId?: number;
    }) =>
      apiFetch(`/campaigns/${campaignId}/pool/add`, poolMutationResponseSchema, {
        method: 'POST',
        body: { count, ...(sourceImportId && { source_import_id: sourceImportId }) },
      }),
    onSuccess: () => invalidateOperational(qc),
  });
}

export function useReleasePoolLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ campaignId, leadIds }: { campaignId: number; leadIds: number[] }) =>
      apiFetch(`/campaigns/${campaignId}/pool/release`, poolMutationResponseSchema, {
        method: 'POST',
        body: { lead_ids: leadIds },
      }),
    onSuccess: () => invalidateOperational(qc),
  });
}

export function useReassignPoolLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      campaignId,
      targetCampaignId,
      leadIds,
    }: {
      campaignId: number;
      targetCampaignId: number;
      leadIds: number[];
    }) =>
      apiFetch(`/campaigns/${campaignId}/pool/reassign`, poolMutationResponseSchema, {
        method: 'POST',
        body: { target_campaign_id: targetCampaignId, lead_ids: leadIds },
      }),
    onSuccess: () => invalidateOperational(qc),
  });
}

export function usePatchAutoEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ campaignId, enabled }: { campaignId: number; enabled: boolean }) =>
      apiFetch(`/campaigns/${campaignId}/auto-enrollment`, patchAutoEnrollmentResponseSchema, {
        method: 'PATCH',
        body: { enabled, ...(enabled && { acknowledge_auto_enrollment: true }) },
      }),
    onSuccess: () => invalidateOperational(qc),
  });
}
