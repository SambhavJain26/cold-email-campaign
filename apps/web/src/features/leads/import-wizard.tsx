import { useState } from 'react';
import { FileUp } from 'lucide-react';
import { toast } from 'sonner';
import {
  IMPORT_ROW_FLAGS,
  type CommitImportResponse,
  type ImportRowFlag,
  type ImportCountsDto,
} from '@coldemail/shared';
import { AppApiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCommitImport, useUploadImport } from '@/api/mutations/imports';
import { useCampaigns } from '@/api/queries/campaigns';
import { useImportDraftPreview } from '@/api/queries/imports';

const MAX_BYTES = 10 * 1024 * 1024; // ingest cap (docs/09)

type Samples = Partial<Record<ImportRowFlag, Array<{ row_no: number; email: string | null }>>>;

interface PreviewState {
  importId: number;
  counts: ImportCountsDto;
  samples: Samples;
  draftCounts: {
    new_leads: number;
    existing_leads: number;
    valid_drafts: number;
    invalid_drafts: number;
  };
}

const FLAG_COPY: Record<ImportRowFlag, { label: string; hint: string }> = {
  ok: { label: 'Clean', hint: 'Importable as-is.' },
  missing_first_name: {
    label: 'Missing first name',
    hint: 'Importable — templates fall back ("Hi there").',
  },
  role_based: {
    label: 'Role-based',
    hint: 'info@/office@ addresses — bounce and get flagged as spam more.',
  },
  invalid: { label: 'Invalid', hint: 'Syntactically broken — never imported.' },
  duplicate: { label: 'Duplicate', hint: 'First occurrence kept; the rest dropped.' },
  suppressed: { label: 'Suppressed', hint: 'Opted out previously — always excluded.' },
};

/** F3.5 — the 3-step import wizard (docs/12 §3): Upload → Preview → Result. */
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
  const [result, setResult] = useState<CommitImportResponse | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ImportRowFlag | null>(null);
  const [draftCampaignId, setDraftCampaignId] = useState<number | undefined>();
  const [replaceDrafts, setReplaceDrafts] = useState(false);
  const campaigns = useCampaigns();
  const draftPreview = useImportDraftPreview(preview?.importId, draftCampaignId);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setPreview(null);
      setResult(null);
      setUploadError(null);
      setExpanded(null);
      setDraftCampaignId(undefined);
      setReplaceDrafts(false);
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
        setPreview({
          importId: result.import_id,
          counts: result.counts,
          samples: result.samples,
          draftCounts: result.draft_counts,
        }),
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
      {
        importId: preview.importId,
        body: {
          mode,
          ...(draftCampaignId !== undefined && { draft_campaign_id: draftCampaignId }),
          replace_existing_drafts: replaceDrafts,
        },
      },
      {
        onSuccess: (commitResult) => {
          setResult(commitResult);
          toast.success(
            `${commitResult.leads_created} leads and ${commitResult.drafts_created + commitResult.drafts_replaced} drafts saved`,
          );
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
            CSV with an email column — headers are matched case-insensitively; unknown columns
            become custom fields.
          </DialogDescription>
        </DialogHeader>

        {/* Step 1 — Upload */}
        {!preview && result === null && (
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

        {/* Step 2 — Preview (the walkthrough panel verbatim) */}
        {preview && counts && result === null && (
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
                            row {s.row_no}: {s.email ?? '—'}
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
                {counts.suppressed} rows opted out previously — they are always excluded, under
                either mode.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Role-based + invalid addresses bounce more and hurt deliverability — dropping flagged
              rows is the safe default.
            </p>
            {(preview.draftCounts.valid_drafts > 0 || preview.draftCounts.invalid_drafts > 0) && (
              <section className="space-y-3 rounded-lg border border-info/40 bg-info/5 p-3">
                <div>
                  <p className="text-sm font-medium">Manual drafts detected</p>
                  <p className="text-xs text-muted-foreground">
                    {preview.draftCounts.valid_drafts} valid · {preview.draftCounts.invalid_drafts}{' '}
                    incomplete. Drafts are Step 1 only and never enroll or send automatically.
                  </p>
                </div>
                <Select
                  value={draftCampaignId ? String(draftCampaignId) : ''}
                  onValueChange={(value) => setDraftCampaignId(Number(value))}
                >
                  <SelectTrigger aria-label="Draft target campaign">
                    <SelectValue placeholder="Select one target campaign…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(campaigns.data?.items ?? []).map((campaign) => (
                      <SelectItem key={campaign.id} value={String(campaign.id)}>
                        {campaign.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {draftPreview.data && (
                  <p className="text-xs text-muted-foreground">
                    {draftPreview.data.new_leads} new leads · {draftPreview.data.existing_leads}{' '}
                    existing leads · {draftPreview.data.valid_drafts} valid drafts ·{' '}
                    {draftPreview.data.invalid_drafts} invalid ·{' '}
                    {draftPreview.data.existing_draft_conflicts} existing-draft conflicts
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="replace-imported-drafts"
                    checked={replaceDrafts}
                    onCheckedChange={(checked) => setReplaceDrafts(checked === true)}
                  />
                  <Label htmlFor="replace-imported-drafts" className="text-xs font-normal">
                    Replace existing unsent drafts (default is skip)
                  </Label>
                </div>
              </section>
            )}
            <div className="flex gap-2">
              <Button
                disabled={
                  commit.isPending ||
                  (preview.draftCounts.valid_drafts > 0 && draftCampaignId === undefined)
                }
                onClick={() => doCommit('drop_flagged')}
              >
                Drop flagged & import {counts.ok}
              </Button>
              <Button
                variant="outline"
                disabled={
                  commit.isPending ||
                  (preview.draftCounts.valid_drafts > 0 && draftCampaignId === undefined)
                }
                onClick={() => doCommit('import_all')}
              >
                Import all incl. role-based ({importAllCount})
              </Button>
            </div>
          </div>
        )}

        {/* Step 3 — Result */}
        {result !== null && (
          <div className="space-y-3 py-2 text-center">
            <p className="text-2xl font-semibold tabular-nums" data-testid="import-result">
              {result.leads_created}
            </p>
            <p className="text-sm text-muted-foreground">
              leads imported — untiered (decision R). Tier them before enrolling.
            </p>
            <dl className="grid grid-cols-2 gap-2 rounded-lg border border-border p-3 text-left text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Drafts created</dt>
                <dd className="font-semibold tabular-nums">{result.drafts_created}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Drafts replaced</dt>
                <dd className="font-semibold tabular-nums">{result.drafts_replaced}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Drafts skipped</dt>
                <dd className="font-semibold tabular-nums">{result.drafts_skipped}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Invalid drafts</dt>
                <dd className="font-semibold tabular-nums">{result.invalid_drafts}</dd>
              </div>
            </dl>
            <Button onClick={() => handleOpenChange(false)}>Go tier them</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
