import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { putSettingsBodySchema, type PutSettingsBody, type SettingsDto } from '@coldemail/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { usePutSettings } from '@/api/mutations/settings';

/** F2.5 — the Stage-0 rules panel: every settings knob, PUT full-row (docs/12 §10). */
export function RulesTab({
  settings,
  onDirtyChange,
}: {
  settings: SettingsDto;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const put = usePutSettings();
  const { updated_at: _ts, ...editable } = settings;
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<PutSettingsBody>({
    resolver: zodResolver(putSettingsBodySchema),
    defaultValues: editable,
  });

  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);

  const onSubmit = (body: PutSettingsBody) =>
    put.mutate(body, {
      onSuccess: (saved) => {
        toast.success('Settings saved');
        const { updated_at: _u, ...next } = saved;
        reset(next); // clears dirty state to the saved row
      },
    });

  const toggle = (name: keyof PutSettingsBody, label: string, hint: string) => (
    <div className="flex items-center justify-between gap-4 py-1">
      <div>
        <Label htmlFor={`rules-${name}`}>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Controller
        name={name}
        control={control}
        render={({ field }) => (
          <Switch
            id={`rules-${name}`}
            checked={field.value as boolean}
            onCheckedChange={field.onChange}
          />
        )}
      />
    </div>
  );

  const num = (name: keyof PutSettingsBody, label: string, hint: string) => (
    <div className="space-y-1">
      <Label htmlFor={`rules-${name}`}>{label}</Label>
      <Input
        id={`rules-${name}`}
        type="number"
        step="any"
        {...register(name, { valueAsNumber: true })}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
      {errors[name] && <p className="text-xs text-destructive">{errors[name]?.message}</p>}
    </div>
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Deliverability rules</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <p className="py-1 text-xs text-muted-foreground">
            Reply handling is configured on each sequence. Hard bounces and STOP/unsubscribe
            requests always end sending.
          </p>
          {toggle(
            'suppress_unsubs',
            'Suppress unsubscribes globally',
            'Opt-outs are blocked from every future campaign, permanently.',
          )}
          {toggle(
            'enforce_send_window',
            'Enforce send window',
            'Only send inside each mailbox’s configured local-time window.',
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Opt-out detection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Controller
            name="optout_detection"
            control={control}
            render={({ field }) => (
              <RadioGroup value={field.value} onValueChange={field.onChange} className="gap-3">
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="auto" id="optout-auto" />
                  <div>
                    <Label htmlFor="optout-auto">Automatic (recommended)</Label>
                    <p className="text-xs text-muted-foreground">
                      A keyword-matched “stop” reply suppresses the lead immediately — decision F’s
                      safe default. The Unibox card shows what happened.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="tag_only" id="optout-tag" />
                  <div>
                    <Label htmlFor="optout-tag">Tag only</Label>
                    <p className="text-xs text-muted-foreground">
                      Detection still flags the reply, but suppression waits for your explicit
                      Unsubscribe click.
                    </p>
                  </div>
                </div>
              </RadioGroup>
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Bounce auto-pause</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {num('pause_min_sends', 'Min sends before rules', 'Volume gate — no pausing below this.')}
          {num('pause_hard_pct', 'Hard-bounce % threshold', '1–20. Percentage-window rule.')}
          {num('pause_window_sends', '% window size (sends)', 'Last-N sends the % is taken over.')}
          {num('pause_absolute_bounces', 'Absolute bounces', 'Absolute rule numerator.')}
          {num('pause_absolute_span', 'Absolute span (sends)', 'Absolute rule window.')}
          {num('resume_cap_pct', 'Resume cap %', 'Cap after auto-pause resume (default 50).')}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Timing</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {num('scheduler_tick_minutes', 'Scheduler tick (min)', 'How often the send loop runs.')}
          {num('poll_interval_minutes', 'IMAP poll (min)', 'Reply/bounce detection cadence.')}
          {num('stale_poll_hours', 'Stale poll (h)', 'No successful poll for this long → flagged.')}
          {num(
            'delivery_confirm_hours',
            'Delivery confirm (h)',
            'sent → delivered after this long with no bounce (decision N).',
          )}
          {num('send_jitter_pct', 'Send jitter %', 'Randomness around the pace gap.')}
          {num('soft_retry_max', 'Soft-bounce retries', 'Attempts before treating as hard.')}
          {num('cold_storage_rest_days', 'Cold-storage rest (days)', 'Wait before recycling.')}
          <div className="space-y-1">
            <Label htmlFor="rules-default_timezone">Default timezone</Label>
            <Input id="rules-default_timezone" {...register('default_timezone')} />
            <p className="text-xs text-muted-foreground">Fallback when a lead has no state.</p>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={put.isPending || !isDirty}>
          Save rules
        </Button>
        {isDirty && <p className="text-xs text-warning">Unsaved changes</p>}
      </div>
    </form>
  );
}
