import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  mailboxSchema,
  okResponseSchema,
  testConnectionResponseSchema,
  type CreateMailboxBody,
  type PatchMailboxBody,
} from '@coldemail/shared';
import { apiFetch } from '../client';

// Fire-and-forget: returning the invalidation promise from a mutation-level
// onSuccess makes React Query AWAIT the refetch before per-call callbacks —
// if the refetch unmounts the calling component (e.g. a failure panel that
// disappears on success), its mutate() callbacks are silently skipped.
function useInvalidateMailboxes() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ['mailboxes'] });
}

export function useCreateMailbox() {
  const invalidate = useInvalidateMailboxes();
  return useMutation({
    mutationFn: (body: CreateMailboxBody) =>
      apiFetch('/mailboxes', mailboxSchema, { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function usePatchMailbox() {
  const invalidate = useInvalidateMailboxes();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: PatchMailboxBody }) =>
      apiFetch(`/mailboxes/${id}`, mailboxSchema, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/mailboxes/${id}/test-connection`, testConnectionResponseSchema, {
        method: 'POST',
      }),
  });
}

export function usePauseMailbox() {
  const invalidate = useInvalidateMailboxes();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/mailboxes/${id}/pause`, okResponseSchema, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useResumeMailbox() {
  const invalidate = useInvalidateMailboxes();
  return useMutation({
    mutationFn: ({ id, cap_pct }: { id: number; cap_pct?: 50 | 100 }) =>
      apiFetch(`/mailboxes/${id}/resume`, okResponseSchema, {
        method: 'POST',
        body: cap_pct === undefined ? {} : { cap_pct },
      }),
    onSuccess: invalidate,
  });
}

export function useReconnectMailbox() {
  const invalidate = useInvalidateMailboxes();
  return useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) =>
      apiFetch(`/mailboxes/${id}/reconnect`, okResponseSchema, {
        method: 'POST',
        body: { password },
      }),
    onSuccess: invalidate,
  });
}
