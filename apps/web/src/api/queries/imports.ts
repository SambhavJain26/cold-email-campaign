import { useQuery } from '@tanstack/react-query';
import { importsListResponseSchema } from '@coldemail/shared';
import { apiFetch } from '../client';

export function useImports(page = 1) {
  return useQuery({
    queryKey: ['imports', page],
    queryFn: () => apiFetch('/imports', importsListResponseSchema, { query: { page } }),
  });
}
