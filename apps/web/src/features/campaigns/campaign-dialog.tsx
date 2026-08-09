import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { createCampaignBodySchema, PERSONALIZATION_MODES } from '@coldemail/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSequences } from '@/api/queries/sequences';
import { useCreateCampaign } from '@/api/mutations/campaigns';

/** The shared create body with both config blocks made REQUIRED — the form always
 *  sends them (prefilled with the server defaults) so the operator sees the knobs
 *  before the first enroll. PATCH only carries name/status, so this is the one
 *  place tier-effort and ramp are set (docs/10 §Campaigns). */
const formSchema = createCampaignBodySchema.required({
  tier_effort_config: true,
  ramp_config: true,
});
type FormValues = z.infer<typeof formSchema>;

const MODE_LABEL: Record<(typeof PERSONALIZATION_MODES)[number], string> = {
  human_written: 'Mode 1 — human-written',
  template_researched: 'Mode 2 — researched slot',
  template_auto: 'Mode 2 — auto slot',
};

/** F5.1 — Create campaign (name + sequence + the docs/08 config editors). */
export function CampaignDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const sequences = useSequences();
  const create = useCreateCampaign();

  const {
    register,
    handleSubmit,
    reset,
    control,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  useEffect(() => {
    if (!open) return;
    reset({
      name: '',
      sequence_id: sequences.data?.items[0]?.id,
      tier_effort_config: {
        A: 'human_written',
        B: 'template_researched',
        C: 'template_auto',
      },
      ramp_config: { ramp_days: 7, ramp_daily_enroll_cap: 20 },
      acknowledge_tier_a_manual: false,
    });
  }, [open, reset, sequences.data]);
  const tierAMode = watch('tier_effort_config.A');

  const onSubmit = (values: FormValues) => {
    create.mutate(values, {
      onSuccess: (campaign) => {
        toast.success(`Campaign "${campaign.name}" created`);
        onOpenChange(false);
        navigate(`/campaigns/${campaign.id}`);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
          <DialogDescription>
            Campaigns start as drafts — nothing sends until you activate one.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-1.5">
            <Label htmlFor="campaign-name">Name</Label>
            <Input id="campaign-name" {...register('name')} />
            {errors.name && (
              <p role="alert" className="text-xs text-destructive">
                {errors.name.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="campaign-sequence">Sequence</Label>
            <Controller
              control={control}
              name="sequence_id"
              render={({ field }) => (
                <Select
                  value={field.value === undefined ? '' : String(field.value)}
                  onValueChange={(value) => field.onChange(Number(value))}
                >
                  <SelectTrigger id="campaign-sequence" className="w-full">
                    <SelectValue placeholder="Select a sequence…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(sequences.data?.items ?? []).map((sequence) => (
                      <SelectItem key={sequence.id} value={String(sequence.id)}>
                        {sequence.name} ({sequence.steps.length} steps)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.sequence_id && (
              <p role="alert" className="text-xs text-destructive">
                A sequence is required
              </p>
            )}
          </div>

          <fieldset className="space-y-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-medium">Effort per tier</legend>
            <p className="text-xs text-muted-foreground">
              How much personalization each tier gets — A is your best-fit leads.
            </p>
            {(['A', 'B', 'C'] as const).map((tier) => (
              <div key={tier} className="flex items-center gap-3">
                <Label htmlFor={`tier-${tier}`} className="w-16 text-xs">
                  Tier {tier}
                </Label>
                <Controller
                  control={control}
                  name={`tier_effort_config.${tier}`}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id={`tier-${tier}`} size="sm" className="flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PERSONALIZATION_MODES.map((mode) => (
                          <SelectItem key={mode} value={mode}>
                            {MODE_LABEL[mode]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            ))}
          </fieldset>

          {tierAMode === 'human_written' && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <Label className="flex cursor-pointer items-start gap-2 text-sm font-normal">
                <Controller
                  control={control}
                  name="acknowledge_tier_a_manual"
                  render={({ field }) => (
                    <Checkbox
                      checked={field.value ?? false}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                    />
                  )}
                />
                <span>
                  Tier A will never be sent by the scheduler. I will write and send these leads
                  through the manual composer.
                </span>
              </Label>
              {errors.acknowledge_tier_a_manual && (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  {errors.acknowledge_tier_a_manual.message}
                </p>
              )}
            </div>
          )}

          <fieldset className="space-y-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-medium">Ramp</legend>
            <p className="text-xs text-muted-foreground">
              New mailboxes warm up: for the first N days the campaign enrolls at most the ramp cap
              per day.
            </p>
            <div className="flex gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="ramp-days" className="text-xs">
                  Ramp days
                </Label>
                <Input
                  id="ramp-days"
                  type="number"
                  min={0}
                  className="h-8 w-24 tabular-nums"
                  {...register('ramp_config.ramp_days', { valueAsNumber: true })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ramp-cap" className="text-xs">
                  Daily enroll cap
                </Label>
                <Input
                  id="ramp-cap"
                  type="number"
                  min={0}
                  className="h-8 w-24 tabular-nums"
                  {...register('ramp_config.ramp_daily_enroll_cap', { valueAsNumber: true })}
                />
              </div>
            </div>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create campaign'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
