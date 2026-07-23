import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  manualSendResponseSchema,
  okResponseSchema,
  type ManualSendBody,
  type Sentiment,
} from '@coldemail/shared';
import { apiFetch } from '../client';

/** The two one-click metrics (tag + meeting) get optimistic updates in F6;
 *  the invalidation set here is the decision-T contract. */
function useInvalidateUniboxMetrics() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['unibox'] });
    qc.invalidateQueries({ queryKey: ['overview'] });
    qc.invalidateQueries({ queryKey: ['analytics'] });
  };
}

export function useTagSentiment() {
  const invalidate = useInvalidateUniboxMetrics();
  return useMutation({
    mutationFn: ({
      incomingMessageId,
      sentiment,
    }: {
      incomingMessageId: number;
      sentiment: Sentiment;
    }) =>
      apiFetch(`/unibox/${incomingMessageId}/sentiment`, okResponseSchema, {
        method: 'POST',
        body: { sentiment },
      }),
    onSuccess: invalidate,
  });
}

export function useMeetingBooked() {
  const invalidate = useInvalidateUniboxMetrics();
  return useMutation({
    mutationFn: (enrollmentId: number) =>
      apiFetch(`/enrollments/${enrollmentId}/meeting-booked`, okResponseSchema, {
        method: 'POST',
      }),
    onSuccess: invalidate,
  });
}

export function useSnooze() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ enrollmentId, until }: { enrollmentId: number; until: string }) =>
      apiFetch(`/enrollments/${enrollmentId}/snooze`, okResponseSchema, {
        method: 'POST',
        body: { until },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['unibox'] }),
  });
}

export function useUnsubscribe() {
  const invalidate = useInvalidateUniboxMetrics();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enrollmentId: number) =>
      apiFetch(`/enrollments/${enrollmentId}/unsubscribe`, okResponseSchema, { method: 'POST' }),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

export function useManualSend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ManualSendBody) =>
      apiFetch('/manual-sends', manualSendResponseSchema, { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['unibox'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}
