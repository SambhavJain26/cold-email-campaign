import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { SequenceDto } from '@coldemail/shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AppApiError } from '@/api/client';
import { useCreateSequence, useUpdateSequence } from '@/api/mutations/sequences';
import {
  blankDraft,
  blankStep,
  draftBlockers,
  draftFromSequence,
  draftsEqual,
  parseSaveErrors,
  saveErrorKey,
  toWriteBody,
  type DraftStep,
  type SequenceDraft,
} from './draft';
import { PreviewPanel, type PreviewTarget } from './preview-panel';
import { StepCard } from './step-card';
import { useUnsavedChanges } from '@/lib/unsaved-changes';

/** F4.2/F4.3/F4.4 — the sequence builder (docs/12 §5). Mounted with `key={sequence.id}`
 *  so a different sequence remounts with fresh state initializers (no setState-in-effect). */
export function SequenceBuilder({ sequence }: { sequence?: SequenceDto }) {
  const navigate = useNavigate();
  const [initialDraft] = useState<SequenceDraft>(() =>
    sequence ? draftFromSequence(sequence) : blankDraft(),
  );
  const [draft, setDraft] = useState<SequenceDraft>(initialDraft);
  const [savedDraft, setSavedDraft] = useState<SequenceDraft>(initialDraft);
  const [saveErrors, setSaveErrors] = useState<Map<string, string>>(new Map());
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [target, setTarget] = useState<PreviewTarget | null>(null);

  const create = useCreateSequence();
  const update = useUpdateSequence();
  const saving = create.isPending || update.isPending;
  const blockers = draftBlockers(draft);
  const dirty = !draftsEqual(draft, savedDraft);
  useUnsavedChanges(dirty);

  const edit = (next: SequenceDraft) => setDraft(next);
  const patchStep = (uid: string, next: DraftStep) =>
    edit({ ...draft, steps: draft.steps.map((step) => (step.uid === uid ? next : step)) });

  const addStep = () =>
    edit({
      ...draft,
      steps: [...draft.steps, blankStep(draft.steps.length > 0, draft.steps.length === 0 ? 0 : 3)],
    });

  const variableEntries = Object.entries(draft.variable_defaults);
  const addVariable = () => {
    let index = variableEntries.length + 1;
    let key = `variable_${index}`;
    while (Object.hasOwn(draft.variable_defaults, key)) key = `variable_${++index}`;
    edit({ ...draft, variable_defaults: { ...draft.variable_defaults, [key]: '' } });
  };
  const renameVariable = (oldKey: string, nextKey: string) => {
    const entries = Object.entries(draft.variable_defaults).map(([key, value]) =>
      key === oldKey ? [nextKey, value] : [key, value],
    );
    edit({ ...draft, variable_defaults: Object.fromEntries(entries) });
  };

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
          onSuccess: (saved) => {
            const next = draftFromSequence(saved);
            setDraft(next);
            setSavedDraft(next);
            toast.success('Sequence saved');
          },
          onError: onSaveError,
        },
      );
    } else {
      create.mutate(body, {
        onSuccess: (created) => {
          const next = draftFromSequence(created);
          setDraft(next);
          setSavedDraft(next);
          toast.success('Sequence created');
          navigate(`/sequences/${created.id}`, { replace: true });
        },
        onError: onSaveError,
      });
    }
  };

  return (
    <div className="space-y-4 p-4 pb-0 sm:p-6 sm:pb-0">
      <div className="flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
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
          <section className="space-y-3 rounded-lg border border-border p-4">
            <div>
              <h2 className="text-sm font-semibold">Sequence variables</h2>
              <p className="text-xs text-muted-foreground">
                Reuse values with tags such as <code>{'{{sequence.competitors|other tools}}'}</code>
                . Values are literal and are not parsed as tags or spintax.
              </p>
            </div>
            {variableEntries.map(([key, value]) => (
              <div key={key} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
                <Input
                  aria-label={`Variable key ${key}`}
                  value={key}
                  onChange={(event) => renameVariable(key, event.target.value.toLowerCase())}
                />
                <Input
                  aria-label={`Variable value ${key}`}
                  value={value}
                  onChange={(event) =>
                    edit({
                      ...draft,
                      variable_defaults: {
                        ...draft.variable_defaults,
                        [key]: event.target.value,
                      },
                    })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    const next = { ...draft.variable_defaults };
                    delete next[key];
                    edit({ ...draft, variable_defaults: next });
                  }}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={addVariable}>
              <Plus className="size-4" /> Add variable
            </Button>
          </section>

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
              Every human reply permanently stops this sequence. This safety rule cannot be
              disabled.
            </p>
          </section>
        </div>

        <PreviewPanel sequenceId={sequence?.id ?? null} target={target} dirty={dirty} />
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-end gap-3">
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
