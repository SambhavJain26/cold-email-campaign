import { cn } from '@/lib/utils';

/** Thin determinate bar with the exact numbers alongside (never a bare %). */
export function ProgressBar({
  value,
  max,
  label,
  className,
}: {
  value: number;
  max: number | null;
  label?: string;
  className?: string;
}) {
  const pct = max === null || max === 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div className={cn('space-y-1', className)}>
      {label && (
        <div className="flex items-baseline justify-between text-xs text-muted-foreground">
          <span>{label}</span>
          <span className="tabular-nums">
            {value}
            {max !== null && ` / ${max}`} ({pct}%)
          </span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max ?? undefined}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
