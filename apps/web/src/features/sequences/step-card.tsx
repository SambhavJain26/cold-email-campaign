import { useState } from 'react';
import { Eye, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  blankVariant,
  nextVariantLabel,
  saveErrorKey,
  type DraftStep,
  type DraftVariant,
} from './draft';
import { TemplateField } from './template-field';

/** F4.2/F4.3 — one step card: wait stepper + in-thread toggle + variant tabs + editors. */
export function StepCard({
  step,
  stepNo,
  canRemove,
  saveErrors,
  onChange,
  onRemove,
  onPreview,
}: {
  step: DraftStep;
  stepNo: number;
  canRemove: boolean;
  saveErrors: Map<string, string>;
  onChange: (next: DraftStep) => void;
  onRemove: () => void;
  onPreview: (stepNo: number, variant: DraftVariant) => void;
}) {
  const [activeUid, setActiveUid] = useState(step.variants[0]?.uid ?? '');
  const active = step.variants.find((v) => v.uid === activeUid) ?? step.variants[0];

  const patchVariant = (uid: string, patch: Partial<DraftVariant>) =>
    onChange({
      ...step,
      variants: step.variants.map((v) => (v.uid === uid ? { ...v, ...patch } : v)),
    });

  const addVariant = () => {
    const variant = blankVariant(nextVariantLabel(step.variants));
    onChange({ ...step, variants: [...step.variants, variant] });
    setActiveUid(variant.uid);
  };

  const removeVariant = (uid: string) => {
    const remaining = step.variants.filter((v) => v.uid !== uid);
    onChange({ ...step, variants: remaining });
    setActiveUid(remaining[0]?.uid ?? '');
  };

  const errorFor = (variant: DraftVariant, field: string) =>
    saveErrors.get(saveErrorKey(stepNo, variant.label, field));
  const variantHasError = (variant: DraftVariant) =>
    errorFor(variant, 'subject_template') !== undefined ||
    errorFor(variant, 'body_template') !== undefined;

  return (
    <section
      className="space-y-3 rounded-lg border border-border p-4"
      data-testid={`step-card-${stepNo}`}
      aria-label={`Step ${stepNo}`}
    >
      <div className="flex flex-wrap items-center gap-4">
        <h2 className="text-sm font-semibold">Step {stepNo}</h2>
        <Select
          value={step.content_source}
          onValueChange={(value: 'template' | 'personalized') =>
            onChange({
              ...step,
              content_source: value,
              variants:
                value === 'personalized'
                  ? []
                  : step.variants.length > 0
                    ? step.variants
                    : [blankVariant('A')],
            })
          }
        >
          <SelectTrigger size="sm" className="w-44" aria-label={`Step ${stepNo} content source`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="template">Template</SelectItem>
            <SelectItem value="personalized">Personalized Copy</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Label htmlFor={`${step.uid}-wait`} className="text-xs text-muted-foreground">
            Wait
          </Label>
          <Input
            id={`${step.uid}-wait`}
            type="number"
            min={0}
            max={90}
            className="h-8 w-16 tabular-nums"
            value={step.wait_days}
            onChange={(event) =>
              onChange({ ...step, wait_days: Math.max(0, Number(event.target.value) || 0) })
            }
          />
          <span className="text-xs text-muted-foreground">
            {stepNo === 1 ? 'days after enrollment' : 'days after the previous step'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id={`${step.uid}-thread`}
            checked={step.in_thread}
            onCheckedChange={(checked) => onChange({ ...step, in_thread: checked })}
          />
          <Label htmlFor={`${step.uid}-thread`} className="text-xs text-muted-foreground">
            Reply in thread
          </Label>
        </div>
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto text-destructive"
          disabled={!canRemove}
          onClick={onRemove}
          aria-label={`Remove step ${stepNo}`}
        >
          <Trash2 className="size-3.5" /> Remove step
        </Button>
      </div>

      {step.content_source === 'personalized' ? (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
          <p className="font-medium">Lead-specific sequence content</p>
          <p className="text-muted-foreground">
            Subject: <code>{'{{manual_subject}}'}</code>
          </p>
          <p className="text-muted-foreground">
            Body: <code>{'{{manual_body}}'}</code>
          </p>
          <p className="text-xs text-muted-foreground">
            This step has no variants. Each lead must have ready campaign copy for this exact step.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Tabs value={active?.uid ?? ''} onValueChange={setActiveUid}>
            <TabsList className="h-8">
              {step.variants.map((variant) => (
                <TabsTrigger key={variant.uid} value={variant.uid} className="text-xs">
                  {variant.label}
                  {!variant.active && <span className="ml-1 text-muted-foreground">(retired)</span>}
                  {variantHasError(variant) && <span className="ml-1 text-destructive">•</span>}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button
            variant="ghost"
            size="xs"
            onClick={addVariant}
            aria-label={`Add variant to step ${stepNo}`}
          >
            <Plus className="size-3.5" /> Variant
          </Button>
          {active && (
            <div className="ml-auto flex items-center gap-2">
              {!active.active && (
                <Badge variant="outline" className="text-[10px]">
                  retired — kept for history
                </Badge>
              )}
              <Button
                variant="ghost"
                size="xs"
                disabled={active.id === undefined}
                title={
                  active.id === undefined ? 'Save the sequence first to preview this variant' : ''
                }
                aria-label={`Preview step ${stepNo} variant ${active.label}`}
                onClick={() => onPreview(stepNo, active)}
              >
                <Eye className="size-3.5" /> Preview
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className="text-destructive"
                disabled={step.variants.length === 1}
                aria-label={`Remove step ${stepNo} variant ${active.label}`}
                onClick={() => removeVariant(active.uid)}
              >
                <Trash2 className="size-3.5" /> Variant
              </Button>
            </div>
          )}
        </div>
      )}

      {step.content_source === 'template' && active && (
        <div className="space-y-3">
          <TemplateField
            id={`${active.uid}-subject`}
            label={
              step.in_thread && stepNo > 1
                ? 'Subject (in-thread steps send as “Re: <step 1 subject>”)'
                : 'Subject'
            }
            rows={2}
            value={active.subject_template}
            serverError={errorFor(active, 'subject_template')}
            onChange={(value) => patchVariant(active.uid, { subject_template: value })}
          />
          <TemplateField
            id={`${active.uid}-body`}
            label="Body"
            rows={10}
            value={active.body_template}
            serverError={errorFor(active, 'body_template')}
            onChange={(value) => patchVariant(active.uid, { body_template: value })}
          />
        </div>
      )}
    </section>
  );
}
