import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  previewResponseSchema,
  sequenceSchema,
  validateTemplateResponseSchema,
  type SequenceWriteBody,
} from '@coldemail/shared';
import { apiFetch } from '../client';

export function useCreateSequence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SequenceWriteBody) =>
      apiFetch('/sequences', sequenceSchema, { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sequences'] }),
  });
}

export function useUpdateSequence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: SequenceWriteBody }) =>
      apiFetch(`/sequences/${id}`, sequenceSchema, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sequences'] }),
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

/** POST-shaped read: live validation chips in the builder (debounced by the caller). */
export function useValidateTemplate() {
  return useMutation({
    mutationFn: (template: string) =>
      apiFetch('/sequences/validate-template', validateTemplateResponseSchema, {
        method: 'POST',
        body: { template },
      }),
  });
}
