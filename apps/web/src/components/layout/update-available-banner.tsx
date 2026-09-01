import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

const currentEntryScript = (): string | null =>
  document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src ?? null;

/** Detect a newly deployed Vite entry bundle without forcing an operator's open form to reload. */
export function UpdateAvailableBanner() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    const loadedEntry = currentEntryScript();
    if (!loadedEntry) return;
    const check = async () => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}?update-check=${Date.now()}`, {
          cache: 'no-store',
          headers: { Accept: 'text/html' },
        });
        if (!response.ok) return;
        const html = new DOMParser().parseFromString(await response.text(), 'text/html');
        const nextSrc = html
          .querySelector<HTMLScriptElement>('script[type="module"][src]')
          ?.getAttribute('src');
        if (nextSrc && new URL(nextSrc, window.location.origin).href !== loadedEntry) {
          setAvailable(true);
        }
      } catch {
        // A version check must never interrupt normal application use.
      }
    };
    const interval = window.setInterval(() => void check(), 60_000);
    void check();
    return () => window.clearInterval(interval);
  }, []);

  if (!available) return null;
  return (
    <div className="flex items-center justify-center gap-3 border-b border-info/40 bg-info/10 px-4 py-2 text-sm">
      <p>A newer application version is available.</p>
      <Button size="xs" variant="outline" onClick={() => window.location.reload()}>
        Refresh now
      </Button>
    </div>
  );
}
