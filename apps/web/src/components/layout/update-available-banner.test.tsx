import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateAvailableBanner } from './update-available-banner';
import { refreshApplication, useUnsavedChanges } from '@/lib/unsaved-changes';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('application update detection', () => {
  it('clears a mismatch when the served build matches, and survives failed checks', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: 'new' }) });
    vi.stubGlobal('fetch', fetcher);
    render(<UpdateAvailableBanner version="running" enabled />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('A newer application version is available.')).toBeInTheDocument();
    expect(fetcher.mock.calls[0]?.[0]).toMatch(/version.json$/);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' });
    fetcher.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByText('A newer application version is available.')).toBeInTheDocument();
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ version: 'running' }) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.queryByText('A newer application version is available.')).toBeNull();
  });
  it('does not announce matching or malformed metadata', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ version: 'running' }) });
    vi.stubGlobal('fetch', fetcher);
    for (let mount = 1; mount <= 3; mount++) {
      const view = render(<UpdateAvailableBanner version="running" enabled />);
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(mount));
      expect(screen.queryByRole('button', { name: 'Refresh now' })).toBeNull();
      view.unmount();
    }
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ unexpected: 'new' }) });
    render(<UpdateAvailableBanner version="running" enabled />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
    expect(screen.queryByRole('button', { name: 'Refresh now' })).toBeNull();
  });
  it('protects dirty forms, clears the guard on unmount, and never reloads automatically', () => {
    function Dirty() {
      useUnsavedChanges(true);
      return null;
    }
    const view = render(<Dirty />);
    const reload = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    refreshApplication(reload);
    expect(reload).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(true);
    refreshApplication(reload);
    expect(reload).toHaveBeenCalledOnce();
    view.unmount();
    refreshApplication(reload);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
