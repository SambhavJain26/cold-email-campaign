import { useQuery } from '@tanstack/react-query';
import { complianceSchema, settingsResponseSchema } from '@coldemail/shared';
import { apiFetch } from '../client';

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch('/settings', settingsResponseSchema),
  });
}

export function useCompliance() {
  return useQuery({
    queryKey: ['compliance'],
    queryFn: () => apiFetch('/compliance', complianceSchema),
  });
}
