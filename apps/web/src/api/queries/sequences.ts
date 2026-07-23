import { useQuery } from '@tanstack/react-query';
import { sequencesListResponseSchema } from '@coldemail/shared';
import { apiFetch } from '../client';

export function useSequences() {
  return useQuery({
    queryKey: ['sequences'],
    queryFn: () => apiFetch('/sequences', sequencesListResponseSchema),
  });
}
