import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  commitImportResponseSchema,
  importPreviewResponseSchema,
  type CommitImportBody,
} from '@coldemail/shared';
import { apiFetch } from '../client';

/** POST /imports - multipart CSV upload → hygiene preview (docs/09). */
export function useUploadImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return apiFetch('/imports', importPreviewResponseSchema, { method: 'POST', body: form });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['imports'] }),
  });
}

export function useCommitImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ importId, body }: { importId: number; body: CommitImportBody }) =>
      apiFetch(`/imports/${importId}/commit`, commitImportResponseSchema, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['imports'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}
