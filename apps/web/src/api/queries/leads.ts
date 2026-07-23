import { useQuery } from '@tanstack/react-query';
import { leadDetailResponseSchema, leadsListResponseSchema } from '@coldemail/shared';
import { apiFetch } from '../client';

export interface LeadsQuery {
  page?: number;
  per_page?: number;
  tier?: string;
  state?: string;
  campaign_id?: number;
  q?: string;
  suppressed?: boolean;
}

export function useLeads(query: LeadsQuery = {}) {
  return useQuery({
    queryKey: ['leads', query],
    queryFn: () => apiFetch('/leads', leadsListResponseSchema, { query: { ...query } }),
  });
}

export function useLead(id: number) {
  return useQuery({
    queryKey: ['leads', 'detail', id],
    queryFn: () => apiFetch(`/leads/${id}`, leadDetailResponseSchema),
  });
}
