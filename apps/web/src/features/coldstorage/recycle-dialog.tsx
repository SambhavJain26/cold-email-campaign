import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
import { AppApiError } from '@/api/client';
import { useCampaigns } from '@/api/queries/campaigns';
import { useRecycle } from '@/api/mutations/campaigns';

interface EnrollResult {
  enrolled: number;
  skipped: { reason: string; count: number }[];
}

/** F7.5 - recycle into a DRAFT target (docs/12 §9). The hash guard (decision Q)
 *  refuses the whole action if the target would re-send identical content. */
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
  const recycle = useRecycle();
  const [targetId, setTargetId] = useState<number | undefined>(undefined);
  const [conflict, setConflict] = useState<number[] | null>(null);
  const [result, setResult] = useState<EnrollResult | null>(null);

  const drafts = (campaigns.data?.items ?? []).filter(
    (c) => c.status === 'draft' && c.id !== sourceCampaignId,
  );

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setConflict(null);
      setResult(null);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Recycle into a campaign</DialogTitle>
          <DialogDescription>
            Rested leads are enrolled into a draft campaign for a second pass. The message must
            differ - nobody receives the same email twice.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-2 text-sm" data-testid="recycle-result">
            <p className="font-medium">Enrolled {result.enrolled} leads.</p>
            {result.skipped.map((bucket) => (
              <p key={bucket.reason} className="text-xs text-muted-foreground">
                Skipped {bucket.count} - {bucket.reason.replaceAll('_', ' ')}
              </p>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="recycle-target" className="text-xs font-medium">
                Target campaign (draft only)
              </label>
              <Select
                value={targetId === undefined ? '' : String(targetId)}
                onValueChange={(value) => {
                  setTargetId(Number(value));
                  setConflict(null);
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
                  Create a draft campaign with a NEW sequence first - that is the second pass.
                </p>
              )}
            </div>

            {conflict && (
              <p role="alert" className="text-xs text-destructive" data-testid="recycle-conflict">
                These leads already received the target sequence&apos;s content at step
                {conflict.length > 1 ? 's' : ''} {conflict.join(', ')} - identical to Pass 1. Change
                the message first; the guard blocks the whole recycle, not just those steps.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            {result ? 'Close' : 'Cancel'}
          </Button>
          {!result && (
            <Button
              disabled={targetId === undefined || recycle.isPending}
              onClick={() => {
                if (targetId === undefined) return;
                setConflict(null);
                recycle.mutate(
                  { targetCampaignId: targetId, sourceCampaignId },
                  {
                    onSuccess: (data) => {
                      setResult(data);
                      toast.success(`Recycled ${data.enrolled} leads`);
                    },
                    onError: (error) => {
                      if (
                        error instanceof AppApiError &&
                        error.code === 'recycle_sequence_conflict'
                      ) {
                        const details = error.details as { step_nos?: number[] } | undefined;
                        setConflict(details?.step_nos ?? []);
                      }
                    },
                  },
                );
              }}
            >
              {recycle.isPending ? 'Recycling…' : 'Recycle'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
