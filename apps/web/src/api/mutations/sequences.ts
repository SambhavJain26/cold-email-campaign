import { useMutation, useQueryClient } from '@tanstack/react-query';
import { previewResponseSchema, sequenceSchema, type SequenceWriteBody } from '@coldemail/shared';
import { apiFetch } from '../client';

export function useCreateSequence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SequenceWriteBody) =>
      apiFetch('/sequences', sequenceSchema, { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sequences'] }),
  });
}

export function useUpdateSequence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: SequenceWriteBody }) =>
      apiFetch(`/sequences/${id}`, sequenceSchema, { method: 'PATCH', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sequences'] }),
  });
}

/** POST-shaped read: render a variant for a real lead through THE renderer. */
export function usePreviewSequence(sequenceId: number) {
  return useMutation({
    mutationFn: (body: { lead_id: number; step_no: number; variant_id: number }) =>
      apiFetch(`/sequences/${sequenceId}/preview`, previewResponseSchema, {
        method: 'POST',
        body,
      }),
  });
}
