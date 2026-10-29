import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { mailboxSchema } from '@coldemail/shared';
import { db } from '@/mocks/db';
import { usePauseMailbox, useReconnectMailbox, useResumeMailbox } from './mailboxes';

afterEach(() => vi.unstubAllGlobals());

describe('mailbox action response contracts', () => {
  const actions = [
    {
      name: 'pause',
      useAction: () => {
        const mutation = usePauseMailbox();
        return () => mutation.mutateAsync(1);
      },
    },
    {
      name: 'resume',
      useAction: () => {
        const mutation = useResumeMailbox();
        return () => mutation.mutateAsync({ id: 1, cap_pct: 100 });
      },
    },
    {
      name: 'reconnect',
      useAction: () => {
        const mutation = useReconnectMailbox();
        return () => mutation.mutateAsync({ id: 1, password: 'test-only' });
      },
    },
  ];

  for (const { name, useAction } of actions) {
    it(`${name} accepts the server Mailbox DTO and refreshes operational data`, async () => {
      const mailbox = mailboxSchema.parse({
        ...db.mailboxes[0],
        status: name === 'pause' ? 'paused' : 'ok',
      });
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(mailbox)));
      vi.stubGlobal('fetch', fetchMock);
      const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
      const invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      );
      const { result } = renderHook(useAction, { wrapper });
      await act(async () => {
        await expect(result.current()).resolves.toEqual(mailbox);
      });
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/mailboxes/1/${name}`),
        expect.objectContaining({ method: 'POST' }),
      );
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['mailboxes'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['overview'] });
      qc.clear();
    });
  }
});
