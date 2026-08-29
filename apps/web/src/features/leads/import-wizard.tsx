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
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import {
  useImportAllocationPreview,
  useImportDraftPreview,
  useImports,
} from '@/api/queries/imports';
import { CollectionPagination } from '@/components/shared/collection-pagination';

interface AllocationRow {
  campaignId?: number;
  count: number;
}

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

function ImportHistory() {
  const [page, setPage] = useState(1);
  const history = useImports(page);
  if (history.isPending) {
    return <p className="text-xs text-muted-foreground">Loading import history…</p>;
  }
  if (history.isError || !history.data) {
    return <p className="text-xs text-destructive">Import history is temporarily unavailable.</p>;
  }
  if (history.data.items.length === 0) return null;
  return (
    <section
      className="space-y-2 border-t border-border pt-4"
      aria-labelledby="import-history-title"
    >
      <div>
        <h3 id="import-history-title" className="text-sm font-medium">
          Import history
        </h3>
        <p className="text-xs text-muted-foreground">
          Campaign reservations remain visible even after leads enroll or are released.
        </p>
      </div>
      <div className="space-y-2">
        {history.data.items.map((item) => (
          <article key={item.id} className="rounded-md border border-border p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{item.filename}</span>
              <Badge variant="outline">{item.committed ? 'Committed' : 'Preview only'}</Badge>
            </div>
            <p className="mt-1 text-muted-foreground">
              Import #{item.id} · {item.rows_total} rows ·{' '}
              {new Date(item.created_at).toLocaleString()}
            </p>
            {item.pool_allocations.length > 0 && (
              <ul className="mt-2 space-y-1">
                {item.pool_allocations.map((allocation) => (
                  <li key={allocation.campaign_id}>
                    {allocation.campaign_name}: {allocation.total} reserved ({allocation.available}{' '}
                    available, {allocation.enrolled} enrolled, {allocation.released} released)
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
      <CollectionPagination
        page={history.data.page}
        perPage={history.data.per_page}
        total={history.data.total}
        onPageChange={setPage}
        paginationLabel="Import history pagination"
      />
    </section>
  );
}

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
  const [commitMode, setCommitMode] = useState<'drop_flagged' | 'import_all'>('drop_flagged');
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);
  const campaigns = useCampaigns();
  const draftPreview = useImportDraftPreview(preview?.importId, draftCampaignId);
  const validAllocations = allocations.filter(
    (allocation): allocation is { campaignId: number; count: number } =>
      allocation.campaignId !== undefined && allocation.count > 0,
  );
  const allocationPreview = useImportAllocationPreview(
    preview?.importId,
    validAllocations.length === allocations.length && allocations.length > 0
      ? {
          mode: commitMode,
          ...(draftCampaignId !== undefined && { draft_campaign_id: draftCampaignId }),
          allocations: validAllocations.map((allocation) => ({
            campaign_id: allocation.campaignId,
            count: allocation.count,
          })),
        }
      : undefined,
  );

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setPreview(null);
      setResult(null);
      setUploadError(null);
      setExpanded(null);
      setDraftCampaignId(undefined);
      setReplaceDrafts(false);
      setCommitMode('drop_flagged');
      setAllocations([]);
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
          allocations: validAllocations.map((allocation) => ({
            campaign_id: allocation.campaignId,
            count: allocation.count,
          })),
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
      <DialogContent className="max-h-[95dvh] max-w-xl overflow-y-auto">
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
            <ImportHistory />
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
            <section className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium">Import mode</p>
                <p className="text-xs text-muted-foreground">
                  Campaign allocation is calculated from this exact safe import set.
                </p>
              </div>
              <Select
                value={commitMode}
                onValueChange={(value) => setCommitMode(value as 'drop_flagged' | 'import_all')}
              >
                <SelectTrigger aria-label="Import mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="drop_flagged">Drop role-based and invalid</SelectItem>
                  <SelectItem value="import_all">Include role-based addresses</SelectItem>
                </SelectContent>
              </Select>
            </section>
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
            <section className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium">Campaign allocation (optional)</p>
                <p className="text-xs text-muted-foreground">
                  Reserve exact counts without enrolling or sending. Any remainder stays in the
                  global Leads list.
                </p>
              </div>
              {allocations.map((allocation, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
                  <Select
                    value={allocation.campaignId ? String(allocation.campaignId) : ''}
                    onValueChange={(value) =>
                      setAllocations((current) =>
                        current.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, campaignId: Number(value) } : row,
                        ),
                      )
                    }
                  >
                    <SelectTrigger aria-label={`Allocation campaign ${index + 1}`}>
                      <SelectValue placeholder="Campaign…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(campaigns.data?.items ?? [])
                        .filter(
                          (campaign) => campaign.status === 'draft' || campaign.status === 'paused',
                        )
                        .filter(
                          (campaign) =>
                            campaign.id === allocation.campaignId ||
                            !allocations.some((row) => row.campaignId === campaign.id),
                        )
                        .map((campaign) => (
                          <SelectItem key={campaign.id} value={String(campaign.id)}>
                            {campaign.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Input
                    aria-label={`Allocation count ${index + 1}`}
                    type="number"
                    min={1}
                    value={allocation.count}
                    onChange={(event) =>
                      setAllocations((current) =>
                        current.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, count: Number(event.target.value) } : row,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setAllocations((current) =>
                        current.filter((_, rowIndex) => rowIndex !== index),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() => setAllocations((current) => [...current, { count: 1 }])}
              >
                Add campaign allocation
              </Button>
              {allocationPreview.isPending && allocations.length > 0 && (
                <p className="text-xs text-muted-foreground">Checking exact availability…</p>
              )}
              {allocationPreview.data && (
                <Alert>
                  <AlertTitle>Allocation preview</AlertTitle>
                  <AlertDescription>
                    {allocationPreview.data.campaigns
                      .map(
                        (item) =>
                          `Campaign #${item.campaign_id}: ${item.allocatable}/${item.requested}`,
                      )
                      .join(' · ')}
                    . {allocationPreview.data.remaining_global} lead(s) will remain global.
                  </AlertDescription>
                </Alert>
              )}
              {allocationPreview.isError && (
                <p role="alert" className="text-xs text-destructive">
                  The requested allocation is not currently available. Adjust the counts and try
                  again.
                </p>
              )}
            </section>
            <Button
              disabled={
                commit.isPending ||
                (preview.draftCounts.valid_drafts > 0 && draftCampaignId === undefined) ||
                validAllocations.length !== allocations.length ||
                (allocations.length > 0 &&
                  (allocationPreview.isPending ||
                    allocationPreview.isError ||
                    !allocationPreview.data ||
                    allocationPreview.data.campaigns.some(
                      (item) => item.allocatable !== item.requested,
                    )))
              }
              onClick={() => doCommit(commitMode)}
            >
              {commitMode === 'drop_flagged'
                ? `Drop flagged & import ${counts.ok}`
                : `Import all incl. role-based (${importAllCount})`}
            </Button>
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
                <dt className="text-muted-foreground">Campaign allocations</dt>
                <dd className="font-semibold tabular-nums">{result.allocations_created}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Remaining global</dt>
                <dd className="font-semibold tabular-nums">{result.remaining_global}</dd>
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
