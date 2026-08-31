import { useQuery } from '@tanstack/react-query';
import {
  importAllocationPreviewResponseSchema,
  importDraftPreviewResponseSchema,
  importsListResponseSchema,
} from '@coldemail/shared';
import { apiFetch } from '../client';

export function useImports(page = 1) {
  return useQuery({
    queryKey: ['imports', page],
    queryFn: () => apiFetch('/imports', importsListResponseSchema, { query: { page } }),
  });
}

export function useImportAllocationPreview(
  importId: number | undefined,
  body:
    | {
        mode: 'drop_flagged' | 'import_all';
        allocations: Array<{
          campaign_id: number;
          count: number;
          generic_copy_step_no?: number;
        }>;
      }
    | undefined,
) {
  return useQuery({
    queryKey: ['imports', importId, 'allocation-preview', body],
    queryFn: () =>
      apiFetch(`/imports/${importId}/allocation-preview`, importAllocationPreviewResponseSchema, {
        method: 'POST',
        body,
      }),
    enabled: importId !== undefined && body !== undefined && body.allocations.length > 0,
  });
}

export function useImportDraftPreview(importId?: number, campaignId?: number) {
  return useQuery({
    queryKey: ['imports', importId, 'draft-preview', campaignId],
    queryFn: () =>
      apiFetch(`/imports/${importId}/draft-preview`, importDraftPreviewResponseSchema, {
        query: { campaign_id: campaignId },
      }),
    enabled: importId !== undefined && campaignId !== undefined,
  });
}
