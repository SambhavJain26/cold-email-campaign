import { useQuery } from '@tanstack/react-query';
import { meResponseSchema } from '@coldemail/shared';
import { apiFetch } from '../client';

/** The auth-guard query — 401 handled by the guard itself, not the central redirect. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch('/auth/me', meResponseSchema, { skipUnauthorizedHandler: true }),
    retry: false,
    staleTime: 5 * 60_000,
  });
}
