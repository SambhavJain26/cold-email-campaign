import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { refreshApplication } from '@/lib/unsaved-changes';

/** Detect a newly deployed Vite entry bundle without forcing an operator's open form to reload. */
export function UpdateAvailableBanner({
  version = typeof __BUILD_VERSION__ === 'string' ? __BUILD_VERSION__ : 'development',
  enabled = !import.meta.env.DEV,
}: { version?: string; enabled?: boolean } = {}) {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}version.json`, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) return;
        const metadata: unknown = await response.json();
        if (
          !disposed &&
          typeof metadata === 'object' &&
          metadata !== null &&
          'version' in metadata &&
          typeof metadata.version === 'string' &&
          metadata.version !== ''
        )
          setAvailable(metadata.version !== version);
      } catch {
        // A version check must never interrupt normal application use.
      } finally {
        checking = false;
      }
    };
    const interval = window.setInterval(() => void check(), 60_000);
    void check();
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [version, enabled]);

  if (!available) return null;
  return (
    <div className="flex items-center justify-center gap-3 border-b border-info/40 bg-info/10 px-4 py-2 text-sm">
      <p>A newer application version is available.</p>
      <Button size="xs" variant="outline" onClick={() => refreshApplication()}>
        Refresh now
      </Button>
    </div>
  );
}
