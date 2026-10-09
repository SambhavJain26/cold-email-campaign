import { useState } from 'react';
import { toast } from 'sonner';
import type { CampaignDto } from '@coldemail/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AppApiError } from '@/api/client';
import { useEnroll } from '@/api/mutations/campaigns';
import { CapacityMeter, type CapacityDto } from './capacity-meter';

/** Why enrolling is impossible right now — stated instead of a dead button (docs/12 §6). */
function blockedReason(campaign: CampaignDto | undefined): string | null {
  if (!campaign) return null;
  if (campaign.sequence_id === null) return 'Attach a sequence before enrolling leads.';
  if (campaign.status === 'draft') return 'Activate the campaign first — a draft never sends.';
  if (campaign.status === 'paused') return 'Campaign is paused — resume it to enroll.';
  if (campaign.status === 'archived') return 'Campaign is archived.';
  return null;
}

/** F5.2/F5.4 — the TODAY panel: capacity meter verbatim + [Enroll next N].
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
  const blocked =
    blockedReason(campaign) ??
    (campaign?.lead_selection_mode === 'pool' && capacity.pool_available === 0
      ? 'No eligible pooled leads are available. Add or release safe leads into this campaign pool.'
      : null);

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
          // The count field is left as typed — capacity refetches underneath, and
          // an over-ask is self-correcting via the 409 below.
        },
        onError: (error) => {
          // 409 capacity_exceeded carries the number that WOULD fit (docs/10).
          if (error instanceof AppApiError && error.code === 'capacity_exceeded') {
            const suggested = (error.details as { suggested?: number } | undefined)?.suggested;
            setRampNote(
              suggested === undefined
                ? error.message
                : `Only ${suggested} additional leads fit today. Reduce the enrollment count to ${suggested}.`,
            );
            if (typeof suggested === 'number') setCount(suggested);
          }
        },
      },
    );
  };

  return (
    <section className={className} data-testid="today-panel">
      <p className="mb-2 text-xs text-muted-foreground">
        Follow-ups get priority. Slots are reserved for follow-ups due later today.
      </p>
      <p className="mb-2 text-xs text-muted-foreground">
        This allowance plans daily capacity; sending windows and safety checks still apply.
      </p>
      <h2 className="mb-3 text-sm font-semibold">TODAY</h2>
      <CapacityMeter capacity={capacity} />

      {campaign && capacity.ramp_day !== null && (
        <div className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <p>
            Ramp started{' '}
            {campaign.first_activated_at
              ? new Date(campaign.first_activated_at).toLocaleDateString()
              : 'on activation'}
            . Pausing does not restart this calendar.
          </p>
          {campaign.ramp_stages.some((stage) => stage.start_day > capacity.ramp_day!) && (
            <p className="mt-1">
              Upcoming:{' '}
              {campaign.ramp_stages
                .filter((stage) => stage.start_day > capacity.ramp_day!)
                .map(
                  (stage) =>
                    `days ${stage.start_day}${stage.end_day === stage.start_day ? '' : `–${stage.end_day}`}: ${stage.cap}`,
                )
                .join(' · ')}
            </p>
          )}
        </div>
      )}

      {campaign?.tier_effort_config.A === 'human_written' && campaign.manual_only_count > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {campaign.manual_only_count} legacy human-written enrollment
          {campaign.manual_only_count === 1 ? ' is' : 's are'} held. Migrate the campaign to
          sequence Personalized Copy before sending.
        </p>
      )}

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
