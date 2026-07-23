import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useTemplateValidation } from '@/api/queries/sequences';
import { useDebounced } from '@/lib/use-debounced';
import { cn } from '@/lib/utils';

/** F4.3 - template editor + live validation chips (validate-template, debounced 500 ms).
 *  Chips report the parse result only; the pre-send checklist lives in the preview panel. */
export function TemplateField({
  id,
  label,
  value,
  rows,
  serverError,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  rows: number;
  serverError?: string;
  onChange: (value: string) => void;
}) {
  const debounced = useDebounced(value, 500);
  const validation = useTemplateValidation(debounced);
  const stale = debounced !== value;
  const parseErrors = validation.data?.errors ?? [];
  const tagCount = (validation.data?.tokens ?? []).filter((t) => t.kind !== 'text').length;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        <div
          className="flex items-center gap-2 text-[11px]"
          data-testid={`${id}-chips`}
          aria-live="polite"
        >
          {(stale || validation.isFetching) && value.trim() !== '' && (
            <Loader2
              className="size-3 animate-spin text-muted-foreground"
              aria-label="validating"
            />
          )}
          {validation.data && !stale && (
            <>
              <span className="text-muted-foreground tabular-nums">
                {tagCount} {tagCount === 1 ? 'tag' : 'tags'}
              </span>
              <span
                className="text-muted-foreground tabular-nums"
                data-testid={`${id}-variations`}
                title="spintax expansions of this template"
              >
                {validation.data.variations}{' '}
                {validation.data.variations === 1 ? 'variation' : 'variations'}
              </span>
              {parseErrors.length === 0 ? (
                <span className="inline-flex items-center gap-1 text-success">
                  <Check className="size-3" aria-hidden /> parses
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-destructive">
                  <AlertTriangle className="size-3" aria-hidden /> {parseErrors.length}{' '}
                  {parseErrors.length === 1 ? 'error' : 'errors'}
                </span>
              )}
            </>
          )}
        </div>
      </div>
      <Textarea
        id={id}
        rows={rows}
        spellCheck={false}
        className={cn(
          'font-mono text-xs',
          (parseErrors.length > 0 || serverError) && 'border-destructive',
        )}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {parseErrors.map((error) => (
        <p
          key={`${error.offset}:${error.message}`}
          role="alert"
          className="text-[11px] text-destructive"
        >
          {error.message} (offset {error.offset})
        </p>
      ))}
      {serverError && (
        <p role="alert" className="text-[11px] text-destructive">
          {serverError}
        </p>
      )}
    </div>
  );
}
