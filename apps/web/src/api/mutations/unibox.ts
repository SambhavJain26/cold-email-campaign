import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  manualSendResponseSchema,
  okResponseSchema,
  type ManualSendBody,
  type Sentiment,
  type UniboxItemDto,
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

type CachedList = { items: UniboxItemDto[] };

function isList(value: unknown): value is CachedList {
  return typeof value === 'object' && value !== null && Array.isArray((value as CachedList).items);
}

function isItem(value: unknown): value is UniboxItemDto {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as UniboxItemDto).incoming_message_id === 'number'
  );
}

/** Patch every cached unibox list AND detail entry the predicate matches, so an
 *  optimistic tag shows instantly on the feed and inside an open thread view. */
function patchUniboxCaches(
  qc: QueryClient,
  matches: (item: UniboxItemDto) => boolean,
  patch: (item: UniboxItemDto) => UniboxItemDto,
): [readonly unknown[], unknown][] {
  const snapshot = qc.getQueriesData({ queryKey: ['unibox'] });
  qc.setQueriesData({ queryKey: ['unibox'] }, (old: unknown) => {
    if (isList(old)) {
      return { ...old, items: old.items.map((item) => (matches(item) ? patch(item) : item)) };
    }
    if (isItem(old) && matches(old)) return { ...old, ...patch(old) };
    return old;
  });
  return snapshot;
}

function restore(qc: QueryClient, snapshot: [readonly unknown[], unknown][] | undefined): void {
  for (const [key, data] of snapshot ?? []) qc.setQueryData(key, data);
}

/** F6.2 — one-click tagging, optimistic (decision T: the actions the operator
 *  repeats dozens of times must feel instant; the server is the truth on settle). */
export function useTagSentiment() {
  const qc = useQueryClient();
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
    onMutate: async ({ incomingMessageId, sentiment }) => {
      await qc.cancelQueries({ queryKey: ['unibox'] });
      const snapshot = patchUniboxCaches(
        qc,
        (item) => item.incoming_message_id === incomingMessageId,
        (item) => ({ ...item, effective_sentiment: sentiment, suggested_sentiment: null }),
      );
      return { snapshot };
    },
    onError: (_error, _variables, context) => restore(qc, context?.snapshot),
    onSettled: invalidate,
  });
}

export function useMeetingBooked() {
  const qc = useQueryClient();
  const invalidate = useInvalidateUniboxMetrics();
  return useMutation({
    mutationFn: (enrollmentId: number) =>
      apiFetch(`/enrollments/${enrollmentId}/meeting-booked`, okResponseSchema, {
        method: 'POST',
      }),
    onMutate: async (enrollmentId) => {
      await qc.cancelQueries({ queryKey: ['unibox'] });
      const snapshot = patchUniboxCaches(
        qc,
        (item) => item.enrollment_id === enrollmentId,
        (item) => ({ ...item, meeting_booked: true }),
      );
      return { snapshot };
    },
    onError: (_error, _variables, context) => restore(qc, context?.snapshot),
    onSettled: invalidate,
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
    // Fire-and-forget: awaiting the refetch here would swallow per-call callbacks
    // if it unmounts the caller (the F2 lesson).
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['unibox'] }),
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
