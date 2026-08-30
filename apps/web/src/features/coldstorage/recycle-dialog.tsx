import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCampaigns } from '@/api/queries/campaigns';
import { useRecycle, useRecyclePreview } from '@/api/mutations/campaigns';

const breakdownLabels: Record<string, string> = {
  unique_leads: 'Unique leads found',
  duplicates: 'Cross-source duplicates',
  rest_period_failures: 'Still resting',
  nurture_exclusions: 'Nurture status',
  untiered_exclusions: 'Untiered',
  personalized_copy_blocks: 'Personalized copy not ready',
  suppression_recontact_blocks: 'Suppression or recontact blocked',
  existing_target_enrollments: 'Already in target',
  prior_content_conflicts: 'Prior-content conflicts',
  eligible: 'Eligible now',
};

export function RecycleDialog({
  sourceCampaignId,
  open,
  onOpenChange,
}: {
  sourceCampaignId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const campaigns = useCampaigns();
  const preview = useRecyclePreview();
  const recycle = useRecycle();
  const [targetId, setTargetId] = useState<number>();
  const [sourceIds, setSourceIds] = useState<number[]>([sourceCampaignId]);
  const [result, setResult] = useState<Awaited<ReturnType<typeof recycle.mutateAsync>> | null>(
    null,
  );

  const drafts = (campaigns.data?.items ?? []).filter((campaign) => campaign.status === 'draft');
  const sources = (campaigns.data?.items ?? []).filter(
    (campaign) => campaign.id !== targetId && campaign.status !== 'draft',
  );

  const resetPreview = () => {
    preview.reset();
    setResult(null);
  };
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      resetPreview();
      setTargetId(undefined);
      setSourceIds([sourceCampaignId]);
    }
    onOpenChange(next);
  };

  const toggleSource = (id: number, checked: boolean) => {
    resetPreview();
    setSourceIds((current) =>
      checked ? [...new Set([...current, id])] : current.filter((sourceId) => sourceId !== id),
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Recycle leads from multiple campaigns</DialogTitle>
          <DialogDescription>
            Combine at least two completed source campaigns into one draft target. Preview is
            read-only; confirmation rechecks every safety rule before enrolling anyone.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 text-sm" data-testid="recycle-result">
            <p className="font-medium">Enrolled {result.enrolled} unique eligible leads.</p>
            <Breakdown values={result.breakdown} />
            <SourceContributions sources={result.sources} />
          </div>
        ) : preview.data ? (
          <div className="space-y-4" data-testid="recycle-preview">
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-sm font-medium">Final confirmation</p>
              <p className="mt-1 text-xs text-muted-foreground">
                The server will recompute this preview at confirmation. Newly suppressed,
                ineligible, or conflicting leads will be skipped; the target stays in draft.
              </p>
            </div>
            <Breakdown values={preview.data.breakdown} />
            <SourceContributions sources={preview.data.sources} />
          </div>
        ) : (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium">
                Source campaigns (select at least two)
              </legend>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                {sources.map((campaign) => (
                  <label
                    key={campaign.id}
                    className="flex min-h-10 cursor-pointer items-center gap-3 rounded px-2 hover:bg-muted"
                  >
                    <Checkbox
                      checked={sourceIds.includes(campaign.id)}
                      onCheckedChange={(checked) => toggleSource(campaign.id, checked === true)}
                    />
                    <span className="text-sm">{campaign.name}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{sourceIds.length} selected</p>
            </fieldset>

            <div className="space-y-1.5">
              <label htmlFor="recycle-target" className="text-xs font-medium">
                Target campaign (draft only)
              </label>
              <Select
                value={targetId === undefined ? '' : String(targetId)}
                onValueChange={(value) => {
                  resetPreview();
                  const next = Number(value);
                  setTargetId(next);
                  setSourceIds((current) => current.filter((id) => id !== next));
                }}
              >
                <SelectTrigger id="recycle-target" className="w-full">
                  <SelectValue
                    placeholder={drafts.length === 0 ? 'No draft campaigns' : 'Select a draft…'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {drafts.map((campaign) => (
                    <SelectItem key={campaign.id} value={String(campaign.id)}>
                      {campaign.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {drafts.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Create a draft campaign with a different message before recycling.
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            {result ? 'Close' : 'Cancel'}
          </Button>
          {!result && !preview.data && (
            <Button
              disabled={targetId === undefined || sourceIds.length < 2 || preview.isPending}
              onClick={() => {
                if (targetId === undefined) return;
                preview.mutate({ targetCampaignId: targetId, sourceCampaignIds: sourceIds });
              }}
            >
              {preview.isPending ? 'Checking…' : 'Preview eligibility'}
            </Button>
          )}
          {!result && preview.data && (
            <>
              <Button variant="outline" onClick={() => preview.reset()}>
                Back
              </Button>
              <Button
                disabled={recycle.isPending || preview.data.breakdown.eligible === 0}
                onClick={() => {
                  if (targetId === undefined) return;
                  recycle.mutate(
                    { targetCampaignId: targetId, sourceCampaignIds: sourceIds },
                    {
                      onSuccess: (data) => {
                        setResult(data);
                        toast.success(`Recycled ${data.enrolled} leads`);
                      },
                    },
                  );
                }}
              >
                {recycle.isPending ? 'Rechecking and enrolling…' : 'Confirm recycle'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Breakdown({ values }: { values: Record<string, number> }) {
  return (
    <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
      {Object.entries(values).map(([key, value]) => (
        <div key={key} className="flex justify-between gap-4 rounded border px-3 py-2">
          <dt className="text-muted-foreground">{breakdownLabels[key] ?? key}</dt>
          <dd className="font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SourceContributions({
  sources,
}: {
  sources: Array<{
    source_campaign_id: number;
    name: string;
    candidates: number;
    eligible: number;
  }>;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium">Per-source contribution</p>
      {sources.map((source) => (
        <p key={source.source_campaign_id} className="text-xs text-muted-foreground">
          {source.name}: {source.eligible} eligible of {source.candidates} candidates
        </p>
      ))}
    </div>
  );
}
