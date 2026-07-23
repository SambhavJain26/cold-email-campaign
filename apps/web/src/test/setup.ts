import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  // RTL auto-cleanup needs vitest globals (off here) - unmount explicitly.
  cleanup();
  // Radix dialogs (react-remove-scroll) set pointer-events:none on <body> and
  // jsdom never restores it across unmounts - scrub it so tests stay isolated.
  document.body.removeAttribute('style');
});

// Recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
