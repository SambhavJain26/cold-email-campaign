import { useState } from 'react';
import { toast } from 'sonner';
import type { CampaignDto } from '@coldemail/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AppApiError } from '@/api/client';
import { useEnroll } from '@/api/mutations/campaigns';
import { CapacityMeter, type CapacityDto } from './capacity-meter';

/** Why enrolling is impossible right now - stated instead of a dead button (docs/12 §6). */
function blockedReason(campaign: CampaignDto | undefined): string | null {
  if (!campaign) return null;
  if (campaign.sequence_id === null) return 'Attach a sequence before enrolling leads.';
  if (campaign.status === 'draft') return 'Activate the campaign first - a draft never sends.';
  if (campaign.status === 'paused') return 'Campaign is paused - resume it to enroll.';
  if (campaign.status === 'archived') return 'Campaign is archived.';
  return null;
}

/** F5.2/F5.4 - the TODAY panel: capacity meter verbatim + [Enroll next N].
 *  Shared by Overview and Campaign detail (features may not import each other). */
export function EnrollPanel({
  campaign,
  capacity,
  className,
}: {
  campaign: CampaignDto | undefined;
  capacity: CapacityDto;
  className?: string;
}) {
  const [count, setCount] = useState<number>(capacity.suggested);
  const [rampNote, setRampNote] = useState<string | null>(null);
  const enroll = useEnroll();
  const blocked = blockedReason(campaign);

  const submit = (n: number) => {
    if (!campaign || n < 1) return;
    setRampNote(null);
    enroll.mutate(
      { campaignId: campaign.id, body: { count: n } },
      {
        onSuccess: (result) => {
          toast.success(`Enrolled ${result.enrolled}`);
          const skipped = result.skipped.reduce((sum, s) => sum + s.count, 0);
          if (skipped > 0) {
            toast.info(
              `Skipped ${skipped}: ${result.skipped.map((s) => `${s.count} ${s.reason}`).join(', ')}`,
            );
          }
          // The count field is left as typed - capacity refetches underneath, and
          // an over-ask is self-correcting via the 409 below.
        },
        onError: (error) => {
          // 409 capacity_exceeded carries the number that WOULD fit (docs/10).
          if (error instanceof AppApiError && error.code === 'capacity_exceeded') {
            const suggested = (error.details as { suggested?: number } | undefined)?.suggested;
            setRampNote(
              suggested === undefined
                ? error.message
                : `Today's ramp cap allows ${suggested} more - the daily cap ramps up over the campaign's ramp_days so mailboxes stay warm.`,
            );
            if (typeof suggested === 'number') setCount(suggested);
          }
        },
      },
    );
  };

  return (
    <section className={className} data-testid="today-panel">
      <h2 className="mb-3 text-sm font-semibold">TODAY</h2>
      <CapacityMeter capacity={capacity} />

      {blocked ? (
        <p className="mt-3 text-xs text-muted-foreground" data-testid="enroll-blocked">
          {blocked}
        </p>
      ) : (
        <div className="mt-3 flex items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="enroll-count" className="text-xs">
              Enroll
            </Label>
            <Input
              id="enroll-count"
              type="number"
              min={1}
              className="h-8 w-20 tabular-nums"
              value={count}
              onChange={(event) => setCount(Math.max(0, Number(event.target.value) || 0))}
            />
          </div>
          <Button size="sm" disabled={enroll.isPending || count < 1} onClick={() => submit(count)}>
            {enroll.isPending ? 'Enrolling…' : `Enroll next ${count}`}
          </Button>
        </div>
      )}

      {rampNote && (
        <p className="mt-2 text-xs text-warning" role="alert" data-testid="ramp-note">
          {rampNote}
        </p>
      )}
    </section>
  );
}
