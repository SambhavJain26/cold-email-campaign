import { useEffect, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { createCampaignBodySchema } from '@coldemail/shared';
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
const formSchema = createCampaignBodySchema.required({ ramp_stages: true });
type FormValues = z.infer<typeof formSchema>;

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
  const wasOpen = useRef(false);
  const [autoField, setAutoField] = useState('');
  const [autoRules, setAutoRules] = useState<Array<{ key: string; value: string }>>([
    { key: 'default', value: '' },
  ]);
  const [overrides, setOverrides] = useState<Array<{ key: string; value: string }>>([]);
  const [testSegment, setTestSegment] = useState('');

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    reset({
      name: '',
      sequence_id: sequences.data?.items[0]?.id,
      ramp_stages: [
        { start_day: 1, end_day: 1, cap: 5 },
        { start_day: 2, end_day: 2, cap: 8 },
        { start_day: 3, end_day: 3, cap: 10 },
        { start_day: 4, end_day: 4, cap: 12 },
        { start_day: 5, end_day: 7, cap: 15 },
      ],
      steady_daily_enroll_cap: 15,
    });
    setAutoField('');
    setAutoRules([{ key: 'default', value: '' }]);
    setOverrides([]);
    setTestSegment('');
  }, [open, reset, sequences.data]);
  const normalizedRuleKeys = autoRules.map((rule) => rule.key.trim().toLowerCase()).filter(Boolean);
  const duplicateRuleKeys = new Set(normalizedRuleKeys).size !== normalizedRuleKeys.length;

  const onSubmit = (values: FormValues) => {
    if (duplicateRuleKeys) {
      toast.error('Auto Observation rule keys must be unique, ignoring case');
      return;
    }
    const rules = Object.fromEntries(
      autoRules
        .filter((rule) => rule.key.trim() !== '' && rule.value.trim() !== '')
        .map((rule) => [rule.key.trim(), rule.value]),
    );
    const variableOverrides = Object.fromEntries(
      overrides
        .filter((entry) => entry.key.trim() !== '')
        .map((entry) => [entry.key.trim().toLowerCase(), entry.value]),
    );
    create.mutate(
      {
        ...values,
        ...(autoField.trim() && Object.keys(rules).length > 0
          ? { auto_observation: { field: autoField.trim(), rules } }
          : {}),
        variable_overrides: variableOverrides,
      },
      {
        onSuccess: (campaign) => {
          toast.success(`Campaign "${campaign.name}" created`);
          onOpenChange(false);
          navigate(`/campaigns/${campaign.id}`);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
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
              Tier A uses researched observations for template steps. Tier B uses Auto Observation.
              Personalized steps use saved lead-specific copy and are independent of tier.
            </p>
            <p className="text-sm">Tier A = Researched · Tier B = Auto</p>
          </fieldset>

          <fieldset className="space-y-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-medium">Activation-based ramp stages</legend>
            <p className="text-xs text-muted-foreground">
              The calendar starts once, on first activation. Pausing does not restart it.
            </p>
            {[0, 1, 2, 3, 4].map((index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-3">
                <Input
                  aria-label={`Ramp stage ${index + 1} start day`}
                  type="number"
                  min={1}
                  {...register(`ramp_stages.${index}.start_day`, { valueAsNumber: true })}
                />
                <Input
                  aria-label={`Ramp stage ${index + 1} end day`}
                  type="number"
                  min={1}
                  {...register(`ramp_stages.${index}.end_day`, { valueAsNumber: true })}
                />
                <Input
                  aria-label={`Ramp stage ${index + 1} cap`}
                  type="number"
                  min={0}
                  {...register(`ramp_stages.${index}.cap`, { valueAsNumber: true })}
                />
              </div>
            ))}
            <div className="flex flex-col gap-1 pt-2">
              <Label htmlFor="steady-enrollment-cap">Permanent daily cap after ramp</Label>
              <Input
                id="steady-enrollment-cap"
                type="number"
                min={1}
                {...register('steady_daily_enroll_cap', { valueAsNumber: true })}
              />
              <p className="text-xs text-muted-foreground">
                Defaults to the final ramp stage. After activation it may only be lowered.
              </p>
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-medium">Auto Observation rules</legend>
            <Input
              aria-label="Auto Observation segmentation field"
              placeholder="Field: state, city, company, industry…"
              value={autoField}
              onChange={(event) => setAutoField(event.target.value)}
            />
            {autoRules.map((rule, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-2">
                <Input
                  aria-label={`Observation rule key ${index + 1}`}
                  placeholder={index === 0 ? 'default' : 'Exact field value'}
                  value={rule.key}
                  disabled={index === 0}
                  onChange={(event) =>
                    setAutoRules((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, key: event.target.value } : item,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={`Observation rule value ${index + 1}`}
                  placeholder="Observation text"
                  value={rule.value}
                  onChange={(event) =>
                    setAutoRules((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, value: event.target.value } : item,
                      ),
                    )
                  }
                />
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAutoRules((current) => [...current, { key: '', value: '' }])}
            >
              Add observation rule
            </Button>
            <Input
              aria-label="Test Auto Observation value"
              placeholder="Preview a field value"
              value={testSegment}
              onChange={(event) => setTestSegment(event.target.value)}
            />
            {testSegment && (
              <p className="text-xs text-muted-foreground">
                Matched rule:{' '}
                {autoRules.find(
                  (rule) =>
                    rule.key !== 'default' &&
                    rule.key.trim().toLowerCase() === testSegment.trim().toLowerCase(),
                )?.key ?? 'default'}
              </p>
            )}
            {duplicateRuleKeys && (
              <p role="alert" className="text-xs text-destructive">
                Duplicate rule keys are not allowed (matching ignores case).
              </p>
            )}
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-medium">Campaign variable overrides</legend>
            {overrides.map((entry, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-2">
                <Input
                  aria-label={`Campaign variable key ${index + 1}`}
                  placeholder="offer_name"
                  value={entry.key}
                  onChange={(event) =>
                    setOverrides((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, key: event.target.value } : item,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={`Campaign variable value ${index + 1}`}
                  value={entry.value}
                  onChange={(event) =>
                    setOverrides((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, value: event.target.value } : item,
                      ),
                    )
                  }
                />
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setOverrides((current) => [...current, { key: '', value: '' }])}
            >
              Add override
            </Button>
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
