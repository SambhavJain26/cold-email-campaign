import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { SequenceDto } from '@coldemail/shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { AppApiError } from '@/api/client';
import { useCreateSequence, useUpdateSequence } from '@/api/mutations/sequences';
import {
  blankDraft,
  blankStep,
  draftBlockers,
  draftFromSequence,
  parseSaveErrors,
  saveErrorKey,
  toWriteBody,
  type DraftStep,
  type SequenceDraft,
} from './draft';
import { PreviewPanel, type PreviewTarget } from './preview-panel';
import { StepCard } from './step-card';

const STOP_CONDITIONS = [
  { key: 'stop_on_reply', label: 'Stop on reply' },
  { key: 'stop_on_hard_bounce', label: 'Stop on hard bounce' },
  { key: 'stop_on_unsubscribe', label: 'Stop on unsubscribe' },
] as const;

/** F4.2/F4.3/F4.4 — the sequence builder (docs/12 §5). Mounted with `key={sequence.id}`
 *  so a different sequence remounts with fresh state initializers (no setState-in-effect). */
export function SequenceBuilder({ sequence }: { sequence?: SequenceDto }) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<SequenceDraft>(() =>
    sequence ? draftFromSequence(sequence) : blankDraft(),
  );
  const [dirty, setDirty] = useState(false);
  const [saveErrors, setSaveErrors] = useState<Map<string, string>>(new Map());
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [target, setTarget] = useState<PreviewTarget | null>(null);

  const create = useCreateSequence();
  const update = useUpdateSequence();
  const saving = create.isPending || update.isPending;
  const blockers = draftBlockers(draft);

  const edit = (next: SequenceDraft) => {
    setDraft(next);
    setDirty(true);
  };
  const patchStep = (uid: string, next: DraftStep) =>
    edit({ ...draft, steps: draft.steps.map((step) => (step.uid === uid ? next : step)) });

  const addStep = () =>
    edit({
      ...draft,
      steps: [...draft.steps, blankStep(draft.steps.length > 0, draft.steps.length === 0 ? 0 : 3)],
    });

  const removeStep = (uid: string) => {
    edit({ ...draft, steps: draft.steps.filter((step) => step.uid !== uid) });
    setTarget(null);
  };

  const onSaveError = (error: unknown) => {
    if (error instanceof AppApiError && error.code === 'sequence_invalid') {
      const parsed = parseSaveErrors(error.details);
      setSaveErrors(
        new Map(
          parsed.errors.map((e) => [saveErrorKey(e.step_no, e.label, e.field), e.message] as const),
        ),
      );
      setConflicts(parsed.conflicts);
    }
  };

  const save = () => {
    setSaveErrors(new Map());
    setConflicts([]);
    const body = toWriteBody(draft);
    if (sequence) {
      update.mutate(
        { id: sequence.id, body },
        {
          onSuccess: () => {
            setDirty(false);
            toast.success('Sequence saved');
          },
          onError: onSaveError,
        },
      );
    } else {
      create.mutate(body, {
        onSuccess: (created) => {
          setDirty(false);
          toast.success('Sequence created');
          navigate(`/sequences/${created.id}`, { replace: true });
        },
        onError: onSaveError,
      });
    }
  };

  return (
    <div className="space-y-4 p-6 pb-24">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="sequence-name" className="text-xs">
            Sequence name
          </Label>
          <Input
            id="sequence-name"
            className="h-9 max-w-md"
            placeholder="Real Estate Outreach v2"
            value={draft.name}
            onChange={(event) => edit({ ...draft, name: event.target.value })}
          />
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/sequences')}>
          Back to list
        </Button>
      </div>

      {conflicts.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>This sequence has already sent — some edits are refused</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {conflicts.map((conflict) => (
                <li key={conflict}>{conflict}</li>
              ))}
            </ul>
            <p className="mt-1">
              Steps cannot be deleted or renumbered once they have sends; removed variants are
              retired instead of deleted.
            </p>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {draft.steps.map((step, index) => (
            <StepCard
              key={step.uid}
              step={step}
              stepNo={index + 1}
              canRemove={draft.steps.length > 1}
              saveErrors={saveErrors}
              onChange={(next) => patchStep(step.uid, next)}
              onRemove={() => removeStep(step.uid)}
              onPreview={(stepNo, variant) => setTarget({ stepNo, variant })}
            />
          ))}

          <Button variant="outline" size="sm" onClick={addStep}>
            <Plus className="size-4" /> Add step
          </Button>

          <section className="space-y-2 rounded-lg border border-border p-4">
            <h2 className="text-sm font-semibold">Stop conditions</h2>
            <p className="text-xs text-muted-foreground">
              When one of these fires, the enrollment leaves the sequence — no further steps send.
            </p>
            <div className="flex flex-wrap gap-6 pt-1">
              {STOP_CONDITIONS.map(({ key, label }) => (
                <div key={key} className="flex items-center gap-2">
                  <Switch
                    id={key}
                    checked={draft[key]}
                    onCheckedChange={(checked) => edit({ ...draft, [key]: checked })}
                  />
                  <Label htmlFor={key} className="text-xs">
                    {label}
                  </Label>
                </div>
              ))}
            </div>
          </section>
        </div>

        <PreviewPanel sequenceId={sequence?.id ?? null} target={target} dirty={dirty} />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background/95 px-6 py-3 backdrop-blur">
        <div className="flex items-center justify-end gap-3">
          {blockers.length > 0 && (
            <span className="text-xs text-muted-foreground" data-testid="save-blockers">
              {blockers[0]}
              {blockers.length > 1 && ` (+${blockers.length - 1} more)`}
            </span>
          )}
          {dirty && blockers.length === 0 && (
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
          )}
          <Button size="sm" disabled={saving || blockers.length > 0} onClick={save}>
            {saving ? 'Saving…' : 'Save sequence'}
          </Button>
        </div>
      </div>
    </div>
  );
}
