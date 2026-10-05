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
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectGroup,
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
import { useCommitImport, useDiscardImportPreview, useUploadImport } from '@/api/mutations/imports';
import { useCampaigns } from '@/api/queries/campaigns';
import { useImportAllocationPreview, useImports } from '@/api/queries/imports';
import { useSequences } from '@/api/queries/sequences';
import { CollectionPagination } from '@/components/shared/collection-pagination';

interface AllocationRow {
  campaignId?: number;
  count: number;
  genericCopyStepNo?: number;
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
  const discard = useDiscardImportPreview();
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
          Committed imports are durable. Preview-only attempts created no leads and can be safely
          discarded.
        </p>
      </div>
      <div className="space-y-2">
        {history.data.items.map((item) => (
          <article key={item.id} className="rounded-md border border-border p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{item.filename}</span>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{item.committed ? 'Committed' : 'Preview only'}</Badge>
                {!item.committed && (
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    disabled={discard.isPending}
                    onClick={() =>
                      discard.mutate(item.id, {
                        onSuccess: () => toast.success('Preview discarded'),
                      })
                    }
                  >
                    Discard
                  </Button>
                )}
              </div>
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
  const [replaceDrafts, setReplaceDrafts] = useState(false);
  const [commitMode, setCommitMode] = useState<'drop_flagged' | 'import_all'>('drop_flagged');
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);
  const campaigns = useCampaigns();
  const sequences = useSequences();
  const importCampaigns = (campaigns.data?.items ?? []).filter(
    (campaign) =>
      campaign.status === 'draft' ||
      campaign.status === 'paused' ||
      (campaign.status === 'active' && !campaign.auto_enroll_enabled),
  );
  const validAllocations = allocations.filter(
    (allocation): allocation is { campaignId: number; count: number; genericCopyStepNo?: number } =>
      allocation.campaignId !== undefined && allocation.count > 0,
  );
  const allocationPreview = useImportAllocationPreview(
    preview?.importId,
    validAllocations.length === allocations.length && allocations.length > 0
      ? {
          mode: commitMode,
          allocations: validAllocations.map((allocation) => ({
            campaign_id: allocation.campaignId,
            count: allocation.count,
            ...(allocation.genericCopyStepNo !== undefined && {
              generic_copy_step_no: allocation.genericCopyStepNo,
            }),
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
          allocations: validAllocations.map((allocation) => ({
            campaign_id: allocation.campaignId,
            count: allocation.count,
            ...(allocation.genericCopyStepNo !== undefined && {
              generic_copy_step_no: allocation.genericCopyStepNo,
            }),
          })),
          replace_existing_drafts: replaceDrafts,
        },
      },
      {
        onSuccess: (commitResult) => {
          setResult(commitResult);
          toast.success(
            `${commitResult.leads_created} leads, ${commitResult.sources_created + commitResult.sources_replaced} copy sources saved`,
          );
        },
      },
    );
  };

  const counts = preview?.counts;
  const importAllCount = counts ? counts.ok + counts.role_based : 0;
  const acceptedCount = counts ? (commitMode === 'drop_flagged' ? counts.ok : importAllCount) : 0;
  const missingGenericStep =
    (!allocationPreview.isFetching &&
      allocationPreview.data?.campaigns.some((campaign) => campaign.generic_copy_step_required)) ||
    false;
  const campaignName = (campaignId: number): string =>
    campaigns.data?.items.find((campaign) => campaign.id === campaignId)?.name ??
    `Campaign ${campaignId}`;
  const personalizedSteps = (campaignId: number | undefined): number[] => {
    if (campaignId === undefined) return [];
    const sequenceId = campaigns.data?.items.find(
      (campaign) => campaign.id === campaignId,
    )?.sequence_id;
    return (
      sequences.data?.items
        .find((sequence) => sequence.id === sequenceId)
        ?.steps.filter((step) => step.content_source === 'personalized')
        .map((step) => step.step_no) ?? []
    );
  };

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
            <FieldSet className="gap-3 rounded-lg border border-border p-3">
              <FieldLegend>Which email addresses should be imported?</FieldLegend>
              <FieldDescription>
                Invalid, duplicate, and previously suppressed addresses are always excluded.
                Campaign allocation uses the option selected here.
              </FieldDescription>
              <RadioGroup
                value={commitMode}
                onValueChange={(value) => setCommitMode(value as 'drop_flagged' | 'import_all')}
              >
                <FieldLabel htmlFor="import-safe-addresses">
                  <Field orientation="horizontal">
                    <RadioGroupItem id="import-safe-addresses" value="drop_flagged" />
                    <FieldContent>
                      <FieldTitle>Safe addresses only — Recommended</FieldTitle>
                      <FieldDescription>
                        Import {counts.ok} clean or usable addresses. Exclude {counts.role_based}{' '}
                        role-based {counts.role_based === 1 ? 'address' : 'addresses'}.
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                </FieldLabel>
                <FieldLabel htmlFor="import-role-addresses">
                  <Field orientation="horizontal">
                    <RadioGroupItem id="import-role-addresses" value="import_all" />
                    <FieldContent>
                      <FieldTitle>Include role-based addresses</FieldTitle>
                      <FieldDescription>
                        Import {importAllCount} addresses, including shared inboxes such as info@ or
                        office@. These generally carry more deliverability risk.
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                </FieldLabel>
              </RadioGroup>
            </FieldSet>
            {(preview.draftCounts.valid_drafts > 0 || preview.draftCounts.invalid_drafts > 0) && (
              <section className="flex flex-col gap-4 rounded-lg border border-info/40 bg-info/5 p-3">
                <div>
                  <h3 className="text-sm font-medium">Personalized emails found in CSV</h3>
                  <p className="text-sm text-muted-foreground">
                    {preview.draftCounts.valid_drafts} complete ·{' '}
                    {preview.draftCounts.invalid_drafts} incomplete or conflicting. Every complete
                    subject/body pair is saved as reusable lead copy and is Ready for sequence use
                    automatically. Campaign and step assignment happens below.
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Exact step_N_subject/body pairs map directly to compatible Personalized Copy
                    steps and do not need a generic destination choice.
                  </p>
                </div>
                <FieldGroup>
                  <FieldSet className="gap-3">
                    <FieldLegend variant="label">If copy already exists</FieldLegend>
                    <RadioGroup
                      value={replaceDrafts ? 'replace' : 'keep'}
                      onValueChange={(value) => setReplaceDrafts(value === 'replace')}
                    >
                      <FieldLabel htmlFor="copy-keep-existing">
                        <Field orientation="horizontal">
                          <RadioGroupItem id="copy-keep-existing" value="keep" />
                          <FieldContent>
                            <FieldTitle>Keep existing copy — Recommended</FieldTitle>
                            <FieldDescription>
                              Preserve any lead source or campaign copy already saved.
                            </FieldDescription>
                          </FieldContent>
                        </Field>
                      </FieldLabel>
                      <FieldLabel htmlFor="copy-replace-existing">
                        <Field orientation="horizontal">
                          <RadioGroupItem id="copy-replace-existing" value="replace" />
                          <FieldContent>
                            <FieldTitle>Replace existing unsent copy</FieldTitle>
                            <FieldDescription>
                              Use this CSV instead. Sent campaign copy remains immutable.
                            </FieldDescription>
                          </FieldContent>
                        </Field>
                      </FieldLabel>
                    </RadioGroup>
                  </FieldSet>
                </FieldGroup>
              </section>
            )}
            <section className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <div>
                <h3 className="text-sm font-medium">Assign leads to campaign pools — Optional</h3>
                <p className="text-sm text-muted-foreground">
                  Reserve accepted CSV rows in order. This does not enroll leads, activate a
                  campaign, or send email.
                </p>
              </div>
              <FieldGroup className="gap-3">
                {allocations.map((allocation, index) => {
                  const availableCampaigns = importCampaigns.filter(
                    (campaign) =>
                      campaign.id === allocation.campaignId ||
                      !allocations.some((row) => row.campaignId === campaign.id),
                  );
                  const stepNos = personalizedSteps(allocation.campaignId);
                  const campaignCopyPreview = allocationPreview.isFetching
                    ? undefined
                    : allocationPreview.data?.campaigns.find(
                        (campaign) => campaign.campaign_id === allocation.campaignId,
                      );
                  const showGenericStepSelector =
                    allocation.genericCopyStepNo !== undefined ||
                    Boolean(
                      campaignCopyPreview &&
                      campaignCopyPreview.generic_copies > 0 &&
                      stepNos.length > 1,
                    );
                  return (
                    <article
                      key={index}
                      className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[minmax(0,1fr)_7rem_auto]"
                    >
                      <Field>
                        <FieldLabel htmlFor={`allocation-campaign-${index + 1}`}>
                          Campaign
                        </FieldLabel>
                        <Select
                          disabled={campaigns.isPending || availableCampaigns.length === 0}
                          value={allocation.campaignId ? String(allocation.campaignId) : ''}
                          onValueChange={(value) =>
                            setAllocations((current) =>
                              current.map((row, rowIndex) =>
                                rowIndex === index
                                  ? {
                                      ...row,
                                      campaignId: Number(value),
                                      genericCopyStepNo: undefined,
                                    }
                                  : row,
                              ),
                            )
                          }
                        >
                          <SelectTrigger
                            id={`allocation-campaign-${index + 1}`}
                            aria-label={`Allocation campaign ${index + 1}`}
                          >
                            <SelectValue
                              placeholder={
                                campaigns.isPending ? 'Loading campaigns…' : 'Choose campaign…'
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {availableCampaigns.map((campaign) => (
                                <SelectItem key={campaign.id} value={String(campaign.id)}>
                                  {campaign.name}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        {campaigns.isError ? (
                          <FieldError>
                            Campaigns could not be loaded. Reopen the import to try again.
                          </FieldError>
                        ) : !campaigns.isPending && availableCampaigns.length === 0 ? (
                          <FieldDescription>
                            No campaigns are available. Choose a draft or paused campaign, or an
                            active campaign with automatic enrollment off. Each campaign can be
                            allocated once.
                          </FieldDescription>
                        ) : null}
                      </Field>
                      <Field>
                        <FieldLabel htmlFor={`allocation-count-${index + 1}`}>Leads</FieldLabel>
                        <Input
                          id={`allocation-count-${index + 1}`}
                          aria-label={`Allocation count ${index + 1}`}
                          type="number"
                          min={1}
                          value={allocation.count}
                          onChange={(event) =>
                            setAllocations((current) =>
                              current.map((row, rowIndex) =>
                                rowIndex === index
                                  ? { ...row, count: Number(event.target.value) }
                                  : row,
                              ),
                            )
                          }
                        />
                      </Field>
                      <Button
                        type="button"
                        variant="ghost"
                        className="self-end"
                        onClick={() =>
                          setAllocations((current) =>
                            current.filter((_, rowIndex) => rowIndex !== index),
                          )
                        }
                      >
                        Remove
                      </Button>
                      {allocation.campaignId !== undefined && (
                        <Field
                          className="sm:col-span-3"
                          data-invalid={
                            campaignCopyPreview?.generic_copy_step_required || undefined
                          }
                        >
                          <FieldLabel htmlFor={`allocation-copy-step-${index + 1}`}>
                            Imported copy destination
                          </FieldLabel>
                          {allocationPreview.isFetching ? (
                            <FieldDescription>Checking this allocation…</FieldDescription>
                          ) : showGenericStepSelector ? (
                            <Select
                              value={
                                allocation.genericCopyStepNo === undefined
                                  ? ''
                                  : String(allocation.genericCopyStepNo)
                              }
                              onValueChange={(value) =>
                                setAllocations((current) =>
                                  current.map((row, rowIndex) =>
                                    rowIndex === index
                                      ? { ...row, genericCopyStepNo: Number(value) }
                                      : row,
                                  ),
                                )
                              }
                            >
                              <SelectTrigger
                                id={`allocation-copy-step-${index + 1}`}
                                aria-label={`Imported copy destination ${index + 1}`}
                                aria-invalid={
                                  campaignCopyPreview?.generic_copy_step_required || undefined
                                }
                              >
                                <SelectValue placeholder="Choose a Personalized Copy step…" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  {stepNos.map((stepNo) => (
                                    <SelectItem key={stepNo} value={String(stepNo)}>
                                      Step {stepNo} — Personalized Copy
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          ) : stepNos.length === 1 &&
                            (campaignCopyPreview?.generic_copies ?? 0) > 0 ? (
                            <FieldDescription>
                              Step {stepNos[0]} — Personalized Copy (assigned automatically)
                            </FieldDescription>
                          ) : stepNos.length === 0 &&
                            (campaignCopyPreview?.generic_copies ?? 0) > 0 ? (
                            <FieldDescription>
                              This sequence has no Personalized Copy step. Imported email remains
                              reusable lead copy only.
                            </FieldDescription>
                          ) : (campaignCopyPreview?.copies_bound ?? 0) > 0 ? (
                            <FieldDescription>
                              Exact step_N_subject/body columns map directly to compatible
                              Personalized Copy steps.
                            </FieldDescription>
                          ) : (
                            <FieldDescription>
                              No personalized email was found to assign.
                            </FieldDescription>
                          )}
                          {campaignCopyPreview?.generic_copy_step_required && (
                            <FieldError>
                              Choose the Personalized Copy step that should use the generic CSV
                              subject and body.
                            </FieldError>
                          )}
                        </Field>
                      )}
                    </article>
                  );
                })}
              </FieldGroup>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAllocations((current) => [...current, { count: 1 }])}
              >
                Add campaign allocation
              </Button>
              {allocationPreview.isFetching && allocations.length > 0 && (
                <p className="text-xs text-muted-foreground">Checking exact availability…</p>
              )}
              {allocationPreview.data && !allocationPreview.isFetching && (
                <Alert>
                  <AlertTitle>What will happen</AlertTitle>
                  <AlertDescription>
                    <ul className="flex list-disc flex-col gap-1 pl-4">
                      <li>{acceptedCount} leads will be imported.</li>
                      {preview.draftCounts.valid_drafts > 0 && (
                        <li>
                          {preview.draftCounts.valid_drafts} reusable personalized emails will be
                          saved as Ready.
                        </li>
                      )}
                      {allocationPreview.data.campaigns.map((item, index) => (
                        <li key={item.campaign_id}>
                          {campaignName(item.campaign_id)}: {index === 0 ? 'first' : 'next'}{' '}
                          {item.requested} accepted leads
                          {item.resolved_generic_copy_step_no !== null
                            ? ` → Personalized Step ${item.resolved_generic_copy_step_no}`
                            : item.generic_copy_step_required
                              ? ' → choose a Personalized Copy step'
                              : item.copies_bound > 0
                                ? ` → ${item.copies_bound} step-specific copies mapped`
                                : item.copies_unassigned > 0
                                  ? ' → copy remains reusable lead copy only'
                                  : ''}
                          .
                        </li>
                      ))}
                      <li>
                        {allocationPreview.data.remaining_global} leads will remain outside campaign
                        pools.
                      </li>
                      <li>This will not activate campaigns, enroll leads, or send email.</li>
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              {allocations.length === 0 && (
                <Alert>
                  <AlertTitle>What will happen</AlertTitle>
                  <AlertDescription>
                    {acceptedCount} leads will be imported and remain outside campaign pools.
                    {preview.draftCounts.valid_drafts > 0
                      ? ` ${preview.draftCounts.valid_drafts} reusable personalized emails will be saved as Ready.`
                      : ''}{' '}
                    This will not activate campaigns, enroll leads, or send email.
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
                validAllocations.length !== allocations.length ||
                (allocations.length > 0 &&
                  (allocationPreview.isFetching ||
                    allocationPreview.isError ||
                    !allocationPreview.data ||
                    missingGenericStep ||
                    allocationPreview.data.campaigns.some(
                      (item) => item.allocatable !== item.requested,
                    )))
              }
              onClick={() => doCommit(commitMode)}
            >
              Import {acceptedCount} leads
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
