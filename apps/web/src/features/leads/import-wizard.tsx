import { useState } from 'react';
import { FileUp } from 'lucide-react';
import { toast } from 'sonner';
import { IMPORT_ROW_FLAGS, type ImportRowFlag, type ImportCountsDto } from '@coldemail/shared';
import { AppApiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCommitImport, useUploadImport } from '@/api/mutations/imports';

const MAX_BYTES = 10 * 1024 * 1024; // ingest cap (docs/09)

type Samples = Partial<Record<ImportRowFlag, Array<{ row_no: number; email: string | null }>>>;

interface PreviewState {
  importId: number;
  counts: ImportCountsDto;
  samples: Samples;
}

const FLAG_COPY: Record<ImportRowFlag, { label: string; hint: string }> = {
  ok: { label: 'Clean', hint: 'Importable as-is.' },
  missing_first_name: {
    label: 'Missing first name',
    hint: 'Importable - templates fall back ("Hi there").',
  },
  role_based: {
    label: 'Role-based',
    hint: 'info@/office@ addresses - bounce and get flagged as spam more.',
  },
  invalid: { label: 'Invalid', hint: 'Syntactically broken - never imported.' },
  duplicate: { label: 'Duplicate', hint: 'First occurrence kept; the rest dropped.' },
  suppressed: { label: 'Suppressed', hint: 'Opted out previously - always excluded.' },
};

/** F3.5 - the 3-step import wizard (docs/12 §3): Upload → Preview → Result. */
export function ImportWizard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const upload = useUploadImport();
  const commit = useCommitImport();
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [imported, setImported] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ImportRowFlag | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setPreview(null);
      setImported(null);
      setUploadError(null);
      setExpanded(null);
    }
    onOpenChange(next);
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    if (file.size > MAX_BYTES) {
      setUploadError('File exceeds the 10 MB import cap.'); // client-side pre-check
      return;
    }
    upload.mutate(file, {
      onSuccess: (result) =>
        setPreview({ importId: result.import_id, counts: result.counts, samples: result.samples }),
      onError: (error) => {
        if (error instanceof AppApiError && error.code === 'import_too_large') {
          setUploadError('The server refused the file: too large (10 MB / 50k rows).');
        }
      },
    });
  };

  const doCommit = (mode: 'drop_flagged' | 'import_all') => {
    if (!preview) return;
    commit.mutate(
      { importId: preview.importId, body: { mode } },
      {
        onSuccess: ({ imported: count }) => {
          setImported(count);
          toast.success(`${count} leads imported`);
        },
      },
    );
  };

  const counts = preview?.counts;
  const importAllCount = counts ? counts.ok + counts.role_based : 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Import leads</DialogTitle>
          <DialogDescription>
            CSV with an email column - headers are matched case-insensitively; unknown columns
            become custom fields.
          </DialogDescription>
        </DialogHeader>

        {/* Step 1 - Upload */}
        {!preview && imported === null && (
          <div className="space-y-3">
            <label
              className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border p-8 text-center hover:bg-accent/30"
              data-testid="upload-dropzone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                onFile(e.dataTransfer.files[0]);
              }}
            >
              <FileUp className="size-8 text-muted-foreground" />
              <p className="text-sm font-medium">
                {upload.isPending ? 'Analyzing…' : 'Drop a CSV here or click to browse'}
              </p>
              <p className="text-xs text-muted-foreground">Max 10 MB · 50,000 rows</p>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                data-testid="upload-input"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </label>
            {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}
          </div>
        )}

        {/* Step 2 - Preview (the walkthrough panel verbatim) */}
        {preview && counts && imported === null && (
          <div className="space-y-3">
            <ul className="divide-y divide-border rounded-lg border border-border text-sm">
              {IMPORT_ROW_FLAGS.map((flag) => {
                const never = flag === 'invalid' || flag === 'suppressed';
                const samples = preview.samples[flag] ?? [];
                return (
                  <li key={flag} className="px-3 py-2">
                    <div className="flex items-baseline justify-between">
                      <span className={never ? 'line-through opacity-60' : undefined}>
                        {FLAG_COPY[flag].label}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {FLAG_COPY[flag].hint}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="font-semibold tabular-nums" data-testid={`count-${flag}`}>
                          {counts[flag]}
                        </span>
                        {samples.length > 0 && (
                          <button
                            className="text-xs text-info hover:underline"
                            onClick={() => setExpanded(expanded === flag ? null : flag)}
                          >
                            {expanded === flag ? 'hide' : 'samples'}
                          </button>
                        )}
                      </span>
                    </div>
                    {expanded === flag && (
                      <ul className="mt-1 space-y-0.5 font-mono text-xs text-muted-foreground">
                        {samples.map((s) => (
                          <li key={s.row_no}>
                            row {s.row_no}: {s.email ?? ' - '}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
            {counts.suppressed > 0 && (
              <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                {counts.suppressed} rows opted out previously - they are always excluded, under
                either mode.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Role-based + invalid addresses bounce more and hurt deliverability - dropping flagged
              rows is the safe default.
            </p>
            <div className="flex gap-2">
              <Button disabled={commit.isPending} onClick={() => doCommit('drop_flagged')}>
                Drop flagged & import {counts.ok}
              </Button>
              <Button
                variant="outline"
                disabled={commit.isPending}
                onClick={() => doCommit('import_all')}
              >
                Import all incl. role-based ({importAllCount})
              </Button>
            </div>
          </div>
        )}

        {/* Step 3 - Result */}
        {imported !== null && (
          <div className="space-y-3 py-2 text-center">
            <p className="text-2xl font-semibold tabular-nums" data-testid="import-result">
              {imported}
            </p>
            <p className="text-sm text-muted-foreground">
              leads imported - untiered (decision R). Tier them before enrolling.
            </p>
            <Button onClick={() => handleOpenChange(false)}>Go tier them</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
