import { useQuery } from '@tanstack/react-query';
import {
  campaignsListResponseSchema,
  capacityResponseSchema,
  coldStorageResponseSchema,
  outcomesResponseSchema,
  campaignPoolResponseSchema,
  autoEnrollmentRunsResponseSchema,
  personalizedCopyCoverageResponseSchema,
} from '@coldemail/shared';
import { apiFetch } from '../client';
import { POLL } from '../queryClient';

export function useCampaigns() {
  return useQuery({
    queryKey: ['campaigns'],
    queryFn: () => apiFetch('/campaigns', campaignsListResponseSchema),
    refetchInterval: POLL.operational,
  });
}

export function usePersonalizedCopyCoverage(campaignId: number) {
  return useQuery({
    queryKey: ['campaigns', campaignId, 'personalized-copy-coverage'],
    queryFn: () =>
      apiFetch(
        `/campaigns/${campaignId}/personalized-copy-coverage`,
        personalizedCopyCoverageResponseSchema,
      ),
    refetchInterval: POLL.operational,
  });
}

export function useCampaignCapacity(campaignId: number) {
  return useQuery({
    queryKey: ['campaigns', 'capacity', campaignId],
    queryFn: () => apiFetch(`/campaigns/${campaignId}/capacity`, capacityResponseSchema),
    refetchInterval: POLL.operational,
  });
}

export function useCampaignOutcomes(campaignId: number) {
  return useQuery({
    queryKey: ['campaigns', 'outcomes', campaignId],
    queryFn: () => apiFetch(`/campaigns/${campaignId}/outcomes`, outcomesResponseSchema),
    refetchInterval: POLL.operational,
  });
}

export function useColdStorage(sourceCampaignId: number, page = 1, perPage = 50) {
  return useQuery({
    queryKey: ['cold-storage', sourceCampaignId, page, perPage],
    queryFn: () =>
      apiFetch('/cold-storage', coldStorageResponseSchema, {
        query: { source_campaign_id: sourceCampaignId, page, per_page: perPage },
      }),
    refetchInterval: POLL.operational,
  });
}

export function useCampaignPool(
  campaignId: number,
  page = 1,
  status?: 'available' | 'enrolled' | 'released',
) {
  return useQuery({
    queryKey: ['campaigns', campaignId, 'pool', page, status],
    queryFn: () =>
      apiFetch(`/campaigns/${campaignId}/pool`, campaignPoolResponseSchema, {
        query: { page, per_page: 50, ...(status && { status }) },
      }),
    refetchInterval: POLL.operational,
  });
}

export function useAutoEnrollmentRuns(campaignId: number, page = 1) {
  return useQuery({
    queryKey: ['campaigns', campaignId, 'auto-enrollment-runs', page],
    queryFn: () =>
      apiFetch(`/campaigns/${campaignId}/auto-enrollment/runs`, autoEnrollmentRunsResponseSchema, {
        query: { page, per_page: 20 },
      }),
    refetchInterval: POLL.operational,
  });
}
