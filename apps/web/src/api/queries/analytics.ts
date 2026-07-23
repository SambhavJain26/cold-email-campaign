import { useQuery } from '@tanstack/react-query';
import {
  healthTrendResponseSchema,
  overviewResponseSchema,
  stepsResponseSchema,
  tiersResponseSchema,
  variantsResponseSchema,
} from '@coldemail/shared';
import { apiFetch } from '../client';
import { POLL } from '../queryClient';

export function useOverview(campaignId: number) {
  return useQuery({
    queryKey: ['overview', campaignId],
    queryFn: () =>
      apiFetch('/analytics/overview', overviewResponseSchema, {
        query: { campaign_id: campaignId },
      }),
    refetchInterval: POLL.overview,
  });
}

export function useVariantAnalytics(sequenceId: number, stepNo = 1) {
  return useQuery({
    queryKey: ['analytics', 'variants', sequenceId, stepNo],
    queryFn: () =>
      apiFetch('/analytics/variants', variantsResponseSchema, {
        query: { sequence_id: sequenceId, step_no: stepNo },
      }),
  });
}

export function useStepAnalytics(params: { sequence_id?: number; campaign_id?: number }) {
  return useQuery({
    queryKey: ['analytics', 'steps', params],
    queryFn: () => apiFetch('/analytics/steps', stepsResponseSchema, { query: { ...params } }),
    enabled: params.sequence_id !== undefined || params.campaign_id !== undefined,
  });
}

export function useTierAnalytics(campaignId: number) {
  return useQuery({
    queryKey: ['analytics', 'tiers', campaignId],
    queryFn: () =>
      apiFetch('/analytics/tiers', tiersResponseSchema, { query: { campaign_id: campaignId } }),
  });
}

export function useHealthTrend(days = 30, campaignId?: number) {
  return useQuery({
    queryKey: ['analytics', 'health-trend', days, campaignId],
    queryFn: () =>
      apiFetch('/analytics/health-trend', healthTrendResponseSchema, {
        query: { days, campaign_id: campaignId },
      }),
  });
}
