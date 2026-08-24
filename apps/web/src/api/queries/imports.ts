import { useQuery } from '@tanstack/react-query';
import { importDraftPreviewResponseSchema, importsListResponseSchema } from '@coldemail/shared';
import { apiFetch } from '../client';

export function useImports(page = 1) {
  return useQuery({
    queryKey: ['imports', page],
    queryFn: () => apiFetch('/imports', importsListResponseSchema, { query: { page } }),
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
