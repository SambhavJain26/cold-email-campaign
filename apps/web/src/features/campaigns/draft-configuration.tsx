import { useState } from 'react';
import { toast } from 'sonner';
import { type CampaignDto } from '@coldemail/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePatchCampaign } from '@/api/mutations/campaigns';

export function DraftConfigurationEditor({ campaign }: { campaign: CampaignDto }) {
  const patch = usePatchCampaign();
  const [stages, setStages] = useState(campaign.ramp_stages);
  const [steadyCap, setSteadyCap] = useState(campaign.steady_daily_enroll_cap);
  const [autoField, setAutoField] = useState(campaign.auto_observation.field ?? '');
  const [rules, setRules] = useState<Array<{ key: string; value: string }>>(() => {
    const entries = Object.entries(campaign.auto_observation.rules);
    return entries.length > 0
      ? entries.map(([key, value]) => ({ key, value }))
      : [{ key: 'default', value: '' }];
  });
  const [overrides, setOverrides] = useState<Array<{ key: string; value: string }>>(() =>
    Object.entries(campaign.variable_overrides).map(([key, value]) => ({ key, value })),
  );

  const save = () => {
    const normalized = rules.map((rule) => rule.key.trim().toLowerCase()).filter(Boolean);
    if (new Set(normalized).size !== normalized.length) {
      toast.error('Observation rule keys must be unique, ignoring case');
      return;
    }
    patch.mutate(
      {
        id: campaign.id,
        body: {
          ramp_stages: stages,
          steady_daily_enroll_cap: steadyCap,
          variable_overrides: Object.fromEntries(
            overrides
              .filter((item) => item.key.trim())
              .map((item) => [item.key.trim().toLowerCase(), item.value]),
          ),
          auto_observation: {
            field: autoField.trim() || null,
            rules: Object.fromEntries(
              rules
                .filter((rule) => rule.key.trim() && rule.value.trim())
                .map((rule) => [rule.key.trim(), rule.value]),
            ),
          },
        },
      },
      { onSuccess: () => toast.success('Draft configuration saved') },
    );
  };

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold">Draft personalization and ramp</h2>
        <p className="text-xs text-muted-foreground">
          Editable until first activation. Activation freezes this configuration permanently.
        </p>
      </div>
      <div className="rounded-md border border-border p-3 text-sm">
        Tier A = Researched · Tier B = Auto. Personalized sequence steps use saved lead copy.
      </div>
      <div className="space-y-2">
        <Label className="text-xs">Ramp stages: start day, end day, new-enrollment cap</Label>
        {stages.map((stage, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-3">
            {(['start_day', 'end_day', 'cap'] as const).map((field) => (
              <Input
                key={field}
                aria-label={`Stage ${index + 1} ${field.replace('_', ' ')}`}
                type="number"
                min={field === 'cap' ? 0 : 1}
                value={stage[field]}
                onChange={(event) =>
                  setStages((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, [field]: Number(event.target.value) } : item,
                    ),
                  )
                }
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="draft-steady-cap" className="text-xs">
          Permanent daily enrollment cap after ramp
        </Label>
        <Input
          id="draft-steady-cap"
          type="number"
          min={1}
          value={steadyCap}
          onChange={(event) => setSteadyCap(Number(event.target.value))}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="draft-auto-field" className="text-xs">
          Auto Observation field
        </Label>
        <Input
          id="draft-auto-field"
          value={autoField}
          onChange={(event) => setAutoField(event.target.value)}
          placeholder="state, city, industry…"
        />
        {rules.map((rule, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-2">
            <Input
              aria-label={`Draft observation key ${index + 1}`}
              value={rule.key}
              disabled={rule.key === 'default'}
              onChange={(event) =>
                setRules((current) =>
                  current.map((item, i) =>
                    i === index ? { ...item, key: event.target.value } : item,
                  ),
                )
              }
            />
            <Input
              aria-label={`Draft observation value ${index + 1}`}
              value={rule.value}
              onChange={(event) =>
                setRules((current) =>
                  current.map((item, i) =>
                    i === index ? { ...item, value: event.target.value } : item,
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
          onClick={() => setRules((current) => [...current, { key: '', value: '' }])}
        >
          Add rule
        </Button>
      </div>
      <div className="space-y-2">
        <Label className="text-xs">Sequence variable overrides</Label>
        {overrides.map((item, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-2">
            <Input
              aria-label={`Draft variable key ${index + 1}`}
              value={item.key}
              onChange={(event) =>
                setOverrides((current) =>
                  current.map((entry, i) =>
                    i === index ? { ...entry, key: event.target.value } : entry,
                  ),
                )
              }
            />
            <Input
              aria-label={`Draft variable value ${index + 1}`}
              value={item.value}
              onChange={(event) =>
                setOverrides((current) =>
                  current.map((entry, i) =>
                    i === index ? { ...entry, value: event.target.value } : entry,
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
      </div>
      <Button disabled={patch.isPending} onClick={save}>
        {patch.isPending ? 'Saving…' : 'Save draft configuration'}
      </Button>
    </section>
  );
}
