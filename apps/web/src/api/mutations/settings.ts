import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  complianceSchema,
  settingsResponseSchema,
  type ComplianceDto,
  type PutSettingsBody,
} from '@coldemail/shared';
import { apiFetch } from '../client';

export function usePutSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PutSettingsBody) =>
      apiFetch('/settings', settingsResponseSchema, { method: 'PUT', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}

export function usePutCompliance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ComplianceDto) =>
      apiFetch('/compliance', complianceSchema, { method: 'PUT', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['compliance'] }),
  });
}
