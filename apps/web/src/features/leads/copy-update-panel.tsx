import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { copyUpdatePreviewSchema } from '@coldemail/shared';
import { apiFetch } from '@/api/client';
import { useCampaigns } from '@/api/queries/campaigns';
import { useSequences } from '@/api/queries/sequences';
import { invalidateOperational } from '@/api/operational-cache';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function CopyUpdatePanel({ importId }: { importId: number }) {
  const [campaignId, setCampaignId] = useState<number>();
  const [stepNo, setStepNo] = useState<number>();
  const [page, setPage] = useState(1);
  const campaigns = useCampaigns();
  const sequences = useSequences();
  const qc = useQueryClient();
  const campaign = campaigns.data?.items.find((item) => item.id === campaignId);
  const steps =
    sequences.data?.items
      .find((item) => item.id === campaign?.sequence_id)
      ?.steps.filter((step) => step.content_source === 'personalized') ?? [];
  const body = {
    campaign_id: campaignId!,
    ...(stepNo !== undefined ? { generic_copy_step_no: stepNo } : {}),
  };
  const preview = useQuery({
    queryKey: ['imports', 'copy-update', importId, body, page],
    queryFn: () =>
      apiFetch(`/imports/${importId}/copy-update-preview`, copyUpdatePreviewSchema, {
        method: 'POST',
        body: { ...body, page },
      }),
    enabled: campaignId !== undefined,
    retry: false,
  });
  const commit = useMutation({
    mutationFn: () =>
      apiFetch(`/imports/${importId}/copy-update-commit`, copyUpdatePreviewSchema, {
        method: 'POST',
        body: { ...body, fingerprint: preview.data!.fingerprint },
      }),
    onSuccess: () => {
      invalidateOperational(qc);
      void qc.invalidateQueries({ queryKey: ['imports'] });
    },
  });
  return (
    <section className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Update only unsent copies for members of a draft or paused campaign. Sent messages and
        retries remain protected. This creates no leads, allocations, enrollments, or sends.
      </p>
      <Select
        value={campaignId?.toString() ?? ''}
        disabled={commit.isPending || commit.isSuccess}
        onValueChange={(value) => {
          setCampaignId(Number(value));
          setStepNo(undefined);
          setPage(1);
          commit.reset();
        }}
      >
        <SelectTrigger aria-label="Copy update campaign">
          <SelectValue placeholder="Choose a draft or paused campaign…" />
        </SelectTrigger>
        <SelectContent>
          {campaigns.data?.items
            .filter((item) => ['draft', 'paused'].includes(item.status))
            .map((item) => (
              <SelectItem key={item.id} value={item.id.toString()}>
                {item.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      {steps.length > 1 && (
        <Select
          value={stepNo?.toString() ?? ''}
          disabled={commit.isPending || commit.isSuccess}
          onValueChange={(value) => {
            setStepNo(Number(value));
            setPage(1);
            commit.reset();
          }}
        >
          <SelectTrigger aria-label="Generic copy destination">
            <SelectValue placeholder="Generic copy destination (step_N columns map directly)…" />
          </SelectTrigger>
          <SelectContent>
            {steps.map((step) => (
              <SelectItem key={step.step_no} value={step.step_no.toString()}>
                Step {step.step_no} — Personalized Copy
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {preview.isFetching && <p>Checking campaign copies…</p>}
      {preview.error && !commit.isSuccess && <p role="alert">{preview.error.message}</p>}
      {preview.data && (
        <>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {Object.entries(preview.data.counts).map(([status, count]) => (
              <div key={status}>
                <dt>{status.replaceAll('_', ' ')}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
          <div className="max-h-48 overflow-auto text-xs">
            <p>
              Page {page} · {preview.data.total_entries} results. Counts represent campaign-step
              copies and skipped rows.
            </p>
            {preview.data.entries.map((entry, index) => (
              <p key={index}>
                Row {entry.row_no} · {entry.email ?? 'invalid address'} ·{' '}
                {entry.step_no ? `Step ${entry.step_no} · ` : ''}
                {entry.status.replaceAll('_', ' ')}: {entry.reason}
              </p>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={page === 1 || preview.isFetching || commit.isPending || commit.isSuccess}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous results
            </Button>
            <Button
              variant="outline"
              disabled={
                page * 100 >= preview.data.total_entries ||
                preview.isFetching ||
                commit.isPending ||
                commit.isSuccess
              }
              onClick={() => setPage((value) => value + 1)}
            >
              Next results
            </Button>
          </div>
          <Button
            disabled={
              preview.isFetching ||
              commit.isPending ||
              commit.isSuccess ||
              preview.data.counts.invalid > 0
            }
            onClick={() => commit.mutate()}
          >
            Update existing campaign copy
          </Button>
        </>
      )}
      {commit.error && (
        <>
          <p role="alert">{commit.error.message}</p>
          <Button
            variant="outline"
            onClick={() => {
              commit.reset();
              void preview.refetch();
            }}
          >
            Refresh update preview
          </Button>
        </>
      )}
      {commit.isSuccess && (
        <p role="status">
          Campaign copy updated: {commit.data.counts.changed} replacements. Campaign progress is
          unchanged. Review the resulting previews before resuming.
        </p>
      )}
    </section>
  );
}
