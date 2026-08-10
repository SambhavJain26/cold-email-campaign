import { useQuery } from '@tanstack/react-query';
import {
  campaignsListResponseSchema,
  capacityResponseSchema,
  coldStorageResponseSchema,
  outcomesResponseSchema,
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

export function useColdStorage(sourceCampaignId: number) {
  return useQuery({
    queryKey: ['cold-storage', sourceCampaignId],
    queryFn: () =>
      apiFetch('/cold-storage', coldStorageResponseSchema, {
        query: { source_campaign_id: sourceCampaignId },
      }),
    refetchInterval: POLL.operational,
  });
}
