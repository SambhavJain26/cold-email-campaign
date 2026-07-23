import type { MetricDto } from '@coldemail/shared';
import { cn } from '@/lib/utils';

/** "Numbers are the product" (docs/11 §5): headline value large, and the full
 *  reconciliation `numerator / denominator = value%` always available on hover
 *  via the title attribute. */
export function MetricStat({
  label,
  metric,
  unit = '%',
  hint,
  className,
}: {
  label: string;
  metric: MetricDto;
  unit?: string;
  /** Optional trailing adornment, e.g. a watch-flag arrow or ✅/⚠️. */
  hint?: React.ReactNode;
  className?: string;
}) {
  const title =
    metric.denominator === null
      ? `${metric.numerator}`
      : `${metric.numerator} / ${metric.denominator} = ${metric.value}${unit}`;
  return (
    <div className={cn('rounded-lg border border-border bg-card p-4', className)} title={title}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        {metric.value}
        {unit}
        {hint && <span className="ml-2 align-middle text-sm">{hint}</span>}
      </p>
    </div>
  );
}
