import { cn } from '@/lib/utils';
import { ProgressBar } from './progress-bar';

export interface CapacityDto {
  total_daily_capacity: number;
  followups_due_today: number;
  sent_so_far_today: number;
  room_for_new: number;
  ramp_cap_remaining: number | null;
  suggested: number;
}

/** The TODAY panel math, verbatim off GET /campaigns/:id/capacity (docs/12 §2). */
export function CapacityMeter({
  capacity,
  className,
}: {
  capacity: CapacityDto;
  className?: string;
}) {
  const rows: Array<[string, string]> = [
    ['Follow-ups due today', String(capacity.followups_due_today)],
    ['Room for new openers', String(capacity.room_for_new)],
  ];
  if (capacity.ramp_cap_remaining !== null) {
    rows.push(['Ramp cap remaining', String(capacity.ramp_cap_remaining)]);
  }
  return (
    <div className={cn('space-y-3', className)} data-testid="capacity-meter">
      <ProgressBar
        label="Sent today"
        value={capacity.sent_so_far_today}
        max={capacity.total_daily_capacity}
      />
      <dl className="space-y-1 text-sm">
        {rows.map(([term, value]) => (
          <div key={term} className="flex justify-between">
            <dt className="text-muted-foreground">{term}</dt>
            <dd className="font-medium tabular-nums">{value}</dd>
          </div>
        ))}
        <div className="flex justify-between border-t border-border pt-1">
          <dt className="text-muted-foreground">Suggested enrollments</dt>
          <dd className="font-semibold tabular-nums" data-testid="suggested">
            {capacity.suggested}
          </dd>
        </div>
      </dl>
    </div>
  );
}
