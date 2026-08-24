import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  manualSendResponseSchema,
  okResponseSchema,
  uniboxItemSchema,
  type ManualSendBody,
  type ReplyDisposition,
  type Sentiment,
  type UniboxItemDto,
} from '@coldemail/shared';
import { apiFetch } from '../client';
import { invalidateOperational } from '../operational-cache';

/** The two one-click metrics (tag + meeting) get optimistic updates in F6;
 *  the invalidation set here is the decision-T contract. */
function useInvalidateUniboxMetrics() {
  const qc = useQueryClient();
  return () => {
    invalidateOperational(qc);
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
      // Returns the updated ITEM, not {ok} — docs/10 and the route's own
      // `response: { 200: uniboxItemSchema }`. Parsing it as okResponseSchema
      // made every successful tag throw client-side: the server appended the
      // event and returned 200, the client rejected the body and toasted
      // "request failed", so the operator retried and produced duplicate
      // sentiment_tagged events in an append-only log (docs/17 §0 finding 18).
      apiFetch(`/unibox/${incomingMessageId}/sentiment`, uniboxItemSchema, {
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

export function useDispositionReply() {
  const qc = useQueryClient();
  const invalidate = useInvalidateUniboxMetrics();
  return useMutation({
    mutationFn: ({
      incomingMessageId,
      disposition,
      recontactAfter,
    }: {
      incomingMessageId: number;
      disposition: ReplyDisposition;
      recontactAfter?: string;
    }) =>
      apiFetch(`/unibox/${incomingMessageId}/disposition`, uniboxItemSchema, {
        method: 'POST',
        body: {
          disposition,
          ...(recontactAfter === undefined ? {} : { recontact_after: recontactAfter }),
        },
      }),
    onMutate: async ({ incomingMessageId, disposition, recontactAfter }) => {
      await qc.cancelQueries({ queryKey: ['unibox'] });
      const snapshot = patchUniboxCaches(
        qc,
        (item) => item.incoming_message_id === incomingMessageId,
        (item) => ({
          ...item,
          disposition,
          recontact_after: recontactAfter ?? null,
          auto_unsubscribed:
            item.auto_unsubscribed ||
            disposition === 'not_interested' ||
            disposition === 'wrong_person' ||
            disposition === 'explicit_unsubscribe',
          lead_suppressed:
            item.lead_suppressed ||
            disposition === 'not_interested' ||
            disposition === 'wrong_person' ||
            disposition === 'explicit_unsubscribe',
        }),
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
    onSuccess: () => invalidateOperational(qc),
  });
}

export function useCreateReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      incomingMessageId,
      dueDate,
      note,
    }: {
      incomingMessageId: number;
      dueDate: string;
      note?: string | null;
    }) =>
      apiFetch(`/unibox/${incomingMessageId}/reminders`, okResponseSchema, {
        method: 'POST',
        body: { due_date: dueDate, ...(note !== undefined && { note }) },
      }),
    onSuccess: () => invalidateOperational(qc),
  });
}

export function usePatchReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      dueDate,
      note,
      status,
    }: {
      id: number;
      dueDate?: string;
      note?: string | null;
      status?: 'open' | 'done' | 'dismissed';
    }) =>
      apiFetch(`/reminders/${id}`, okResponseSchema, {
        method: 'PATCH',
        body: {
          ...(dueDate !== undefined && { due_date: dueDate }),
          ...(note !== undefined && { note }),
          ...(status !== undefined && { status }),
        },
      }),
    onSuccess: () => invalidateOperational(qc),
  });
}

export function useUnsubscribe() {
  const invalidate = useInvalidateUniboxMetrics();
  return useMutation({
    mutationFn: (enrollmentId: number) =>
      apiFetch(`/enrollments/${enrollmentId}/unsubscribe`, okResponseSchema, { method: 'POST' }),
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useManualSend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ManualSendBody) =>
      apiFetch('/manual-sends', manualSendResponseSchema, { method: 'POST', body }),
    onSuccess: () => invalidateOperational(qc),
  });
}
