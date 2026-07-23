import { useQuery } from '@tanstack/react-query';
import {
  previewResponseSchema,
  sequencesListResponseSchema,
  validateTemplateResponseSchema,
} from '@coldemail/shared';
import { apiFetch } from '../client';

export function useSequences() {
  return useQuery({
    queryKey: ['sequences'],
    queryFn: () => apiFetch('/sequences', sequencesListResponseSchema),
  });
}

/** POST-shaped read of the same render the builder previews on demand — this is the
 *  AUTOMATIC variant (F6.4's composer prefills from it as soon as it opens, so it
 *  must be a query the render can read, not a button-triggered mutation). */
export function useSequencePreview(
  sequenceId: number | undefined,
  body: { lead_id: number; step_no: number; variant_id: number } | undefined,
) {
  return useQuery({
    queryKey: ['sequences', 'preview', sequenceId, body],
    queryFn: () =>
      apiFetch(`/sequences/${sequenceId}/preview`, previewResponseSchema, {
        method: 'POST',
        body,
      }),
    enabled: sequenceId !== undefined && body !== undefined,
    staleTime: 60_000,
  });
}

/** POST-shaped read: the builder's live validation chips. Callers pass a DEBOUNCED
 *  template (docs/12 §5, 500 ms) — the key caches per distinct template text. */
export function useTemplateValidation(template: string) {
  return useQuery({
    queryKey: ['validate-template', template],
    queryFn: () =>
      apiFetch('/sequences/validate-template', validateTemplateResponseSchema, {
        method: 'POST',
        body: { template },
      }),
    enabled: template.trim().length > 0,
    staleTime: 5 * 60_000,
  });
}
