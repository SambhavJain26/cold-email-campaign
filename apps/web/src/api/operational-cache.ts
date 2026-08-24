import type { QueryClient } from '@tanstack/react-query';

/**
 * One invalidation policy for screens whose data derives from live events or
 * scheduler state. It keeps an operator's current view truthful immediately
 * after an action; foreground polling covers changes made elsewhere.
 */
export function invalidateOperational(qc: QueryClient): void {
  for (const queryKey of [
    ['campaigns'],
    ['overview'],
    ['analytics'],
    ['leads'],
    ['unibox'],
    ['reminders'],
    ['mailboxes'],
    ['system'],
    ['cold-storage'],
    ['alerts'],
  ]) {
    void qc.invalidateQueries({ queryKey });
  }
}
