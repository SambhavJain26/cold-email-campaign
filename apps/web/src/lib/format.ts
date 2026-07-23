// Formatters (docs/11 §1 lib): dates + percentages with their numerators.

/** "3m ago" / "2h ago" / "5d ago" - alert feed + unibox relative times. */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const diffMs = now.getTime() - then;
  if (Number.isNaN(then)) return iso;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "72 / 867 = 8.3%" - the reconciliation string (docs/11 §5). */
export function formatMetric(numerator: number, denominator: number | null, value: number): string {
  if (denominator === null) return String(numerator);
  return `${numerator} / ${denominator} = ${value}%`;
}
