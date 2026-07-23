import { useMutation } from '@tanstack/react-query';
import { rebuildResponseSchema } from '@coldemail/shared';
import { apiFetch } from '../client';

export function useRebuildProjections() {
  return useMutation({
    mutationFn: (dryRun: boolean) =>
      apiFetch('/system/rebuild-projections', rebuildResponseSchema, {
        method: 'POST',
        body: { dry_run: dryRun },
      }),
  });
}
