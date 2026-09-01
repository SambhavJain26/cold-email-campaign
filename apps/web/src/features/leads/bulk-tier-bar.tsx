import { useState } from 'react';
import { toast } from 'sonner';
import type { BulkOutreachStatusBody, BulkTierBody, CurrentLeadTier } from '@coldemail/shared';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useBulkOutreachStatus, useBulkTier } from '@/api/mutations/leads';

/** F3.2 — appears once rows are selected: pick a tier, apply to the selected
 *  ids OR to everything matching the current filter (docs/12 §2). */
export function BulkTierBar({
  selectedCount,
  allMatching,
  matchingTotal,
  buildBody,
  buildOutreachBody,
  onDone,
  onApplied,
}: {
  selectedCount: number;
  /** True when "select all N matching filter" was chosen. */
  allMatching: boolean;
  matchingTotal: number;
  /** Page owns the ids-vs-filter body shape. */
  buildBody: (tier: CurrentLeadTier | null) => BulkTierBody;
  buildOutreachBody: (status: 'standard' | 'nurture') => BulkOutreachStatusBody;
  onDone: () => void;
  onApplied: (updated: number, action: string) => void;
}) {
  const [tier, setTier] = useState<string>('');
  const bulkTier = useBulkTier();
  const bulkOutreach = useBulkOutreachStatus();
  const count = allMatching ? matchingTotal : selectedCount;

  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-info/40 bg-info/10 px-4 py-2"
      data-testid="bulk-tier-bar"
    >
      <p className="text-sm">
        <span className="font-semibold tabular-nums">{count}</span>{' '}
        {allMatching ? 'matching leads' : 'selected'}
      </p>
      <Select value={tier} onValueChange={setTier}>
        <SelectTrigger size="sm" className="w-36" aria-label="Bulk tier">
          <SelectValue placeholder="Set tier…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="A">🟢 Tier A</SelectItem>
          <SelectItem value="B">🟡 Tier B</SelectItem>
          <SelectItem value="clear">— clear tier</SelectItem>
        </SelectContent>
      </Select>
      <Button
        size="sm"
        disabled={tier === '' || bulkTier.isPending}
        onClick={() =>
          bulkTier.mutate(buildBody(tier === 'clear' ? null : (tier as CurrentLeadTier)), {
            onSuccess: ({ updated }) => {
              toast.success(`${updated} leads re-tiered`);
              onApplied(updated, 're-tiered');
              onDone();
            },
          })
        }
      >
        Apply
      </Button>
      <Button size="sm" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={bulkOutreach.isPending}
        onClick={() =>
          bulkOutreach.mutate(buildOutreachBody('nurture'), {
            onSuccess: ({ updated }) => {
              toast.success(`${updated} leads moved to Nurture`);
              onApplied(updated, 'moved to Nurture');
              onDone();
            },
          })
        }
      >
        Move to Nurture
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={bulkOutreach.isPending}
        onClick={() =>
          bulkOutreach.mutate(buildOutreachBody('standard'), {
            onSuccess: ({ updated }) => {
              toast.success(`${updated} leads restored as untiered`);
              onApplied(updated, 'restored as untiered');
              onDone();
            },
          })
        }
      >
        Restore from Nurture
      </Button>
    </div>
  );
}
