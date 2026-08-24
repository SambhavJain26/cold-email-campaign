import { useQuery } from '@tanstack/react-query';
import {
  manualComposePrefillSchema,
  reminderListResponseSchema,
  uniboxDetailResponseSchema,
  uniboxListResponseSchema,
} from '@coldemail/shared';
import { apiFetch } from '../client';
import { POLL } from '../queryClient';

export interface UniboxQuery {
  page?: number;
  per_page?: number;
  bucket?: 'human' | 'auto_reply';
  sentiment?: 'positive' | 'neutral' | 'negative';
  mailbox_id?: number;
  unhandled?: boolean;
}

export function useManualComposePrefill(enrollmentId: number | undefined) {
  return useQuery({
    queryKey: ['manual-compose-prefill', enrollmentId],
    queryFn: () =>
      apiFetch(`/enrollments/${enrollmentId}/manual-compose-prefill`, manualComposePrefillSchema),
    enabled: enrollmentId !== undefined,
  });
}

export interface ReminderQuery {
  page?: number;
  per_page?: number;
  view?: 'due_today' | 'upcoming' | 'overdue' | 'all';
  status?: 'open' | 'done' | 'dismissed';
}

export function useReminders(query: ReminderQuery = {}) {
  return useQuery({
    queryKey: ['reminders', query],
    queryFn: () => apiFetch('/reminders', reminderListResponseSchema, { query: { ...query } }),
    refetchInterval: POLL.operational,
  });
}

export function useUnibox(query: UniboxQuery = {}) {
  return useQuery({
    queryKey: ['unibox', query],
    queryFn: () => apiFetch('/unibox', uniboxListResponseSchema, { query: { ...query } }),
    refetchInterval: POLL.unibox,
  });
}

export function useUniboxItem(incomingMessageId: number) {
  return useQuery({
    queryKey: ['unibox', 'detail', incomingMessageId],
    queryFn: () => apiFetch(`/unibox/${incomingMessageId}`, uniboxDetailResponseSchema),
    refetchInterval: POLL.operational,
  });
}
