import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  okResponseSchema,
  incomingMessageSchema,
  incomingRetentionSchema,
} from '@coldemail/shared';
import { apiFetch } from '../client';
import { invalidateOperational } from '../operational-cache';

export function useIncomingMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      path,
      body,
      method = 'POST',
      result = 'ok',
    }: {
      path: string;
      body: unknown;
      method?: 'POST' | 'DELETE' | 'PUT';
      result?: 'ok' | 'message' | 'retention';
    }): Promise<unknown> =>
      result === 'message'
        ? apiFetch(path, incomingMessageSchema, { method, body })
        : result === 'retention'
          ? apiFetch(path, incomingRetentionSchema, { method, body })
          : apiFetch(path, okResponseSchema, { method, body }),
    onSuccess: (data, variables) => {
      if (variables.result === 'message') {
        const message = incomingMessageSchema.parse(data);
        qc.setQueryData(['incoming-review', 'message', message.id], message);
      }
      void qc.invalidateQueries({ queryKey: ['incoming-review'] });
      invalidateOperational(qc);
    },
    onError: () => {
      void qc.invalidateQueries({ queryKey: ['incoming-review'] });
    },
  });
}
