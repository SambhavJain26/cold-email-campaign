import { useQuery } from '@tanstack/react-query';
import { sequencesListResponseSchema, validateTemplateResponseSchema } from '@coldemail/shared';
import { apiFetch } from '../client';

export function useSequences() {
  return useQuery({
    queryKey: ['sequences'],
    queryFn: () => apiFetch('/sequences', sequencesListResponseSchema),
  });
}

/** POST-shaped read: the builder's live validation chips. Callers pass a DEBOUNCED
 *  template (docs/12 §5, 500 ms) - the key caches per distinct template text. */
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
