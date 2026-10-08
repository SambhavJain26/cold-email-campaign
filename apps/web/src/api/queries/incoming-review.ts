import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  incomingRowsResponseSchema,
  incomingContextSchema,
  incomingMessageListSchema,
  incomingMessageSchema,
  incomingRetentionSchema,
  type IncomingReviewRow,
} from '@coldemail/shared';
import { apiFetch } from '../client';
import { POLL } from '../queryClient';

export function useIncomingRows(query: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: ['incoming-review', 'rows', query],
    queryFn: () => apiFetch('/unibox/rows', incomingRowsResponseSchema, { query }),
    refetchInterval: POLL.operational,
  });
}
export function useNeedsLinking(page: number, enabled: boolean, view = 'needs_review') {
  return useQuery({
    queryKey: ['incoming-review', 'linking', page, view],
    queryFn: () =>
      apiFetch('/unibox/needs-linking', incomingMessageListSchema, {
        query: { page, per_page: 25, view },
      }),
    enabled,
    refetchInterval: POLL.operational,
  });
}
export function useIncomingContext(row: IncomingReviewRow | null) {
  return useQuery({
    queryKey: ['incoming-review', 'context', row?.lead_id, row?.campaign_id],
    queryFn: () =>
      row!.enrollment_id
        ? apiFetch(`/unibox/rows/${row!.enrollment_id}/messages`, incomingContextSchema)
        : apiFetch('/unibox/lead-messages', incomingContextSchema, {
            query: { lead_id: row!.lead_id, campaign_id: row!.campaign_id },
          }),
    enabled: !!row,
    refetchInterval: POLL.operational,
  });
}
export function useIncomingMessage(id: number | null) {
  return useQuery({
    queryKey: ['incoming-review', 'message', id],
    queryFn: () => apiFetch(`/unibox/messages/${id}`, incomingMessageSchema),
    enabled: id !== null,
    refetchInterval: POLL.operational,
  });
}
export const linkCandidateResponseSchema = z.object({
  items: z.array(
    z.object({
      lead_id: z.number(),
      enrollment_id: z.number().nullable(),
      name: z.string(),
      email: z.string(),
      company: z.string().nullable(),
      state: z.string(),
    }),
  ),
});
export function useLinkCandidates(
  campaignId: number | null,
  search: string,
  companySender?: string,
) {
  return useQuery({
    queryKey: ['incoming-review', 'candidates', campaignId, search, companySender],
    queryFn: () =>
      apiFetch('/unibox/link-candidates', linkCandidateResponseSchema, {
        query: { campaign_id: campaignId ?? undefined, search, company_sender: companySender },
      }),
    enabled: campaignId !== null,
  });
}
export function useIncomingRetention() {
  return useQuery({
    queryKey: ['incoming-review', 'retention'],
    queryFn: () => apiFetch('/unibox/retention', incomingRetentionSchema),
  });
}
