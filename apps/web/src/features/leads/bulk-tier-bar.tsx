import { useState } from 'react';
import { toast } from 'sonner';
import type { BulkTierBody, LeadTier } from '@coldemail/shared';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useBulkTier } from '@/api/mutations/leads';

/** F3.2 - appears once rows are selected: pick a tier, apply to the selected
 *  ids OR to everything matching the current filter (docs/12 §2). */
export function BulkTierBar({
  selectedCount,
  allMatching,
  matchingTotal,
  buildBody,
  onDone,
}: {
  selectedCount: number;
  /** True when "select all N matching filter" was chosen. */
  allMatching: boolean;
  matchingTotal: number;
  /** Page owns the ids-vs-filter body shape. */
  buildBody: (tier: LeadTier | null) => BulkTierBody;
  onDone: () => void;
}) {
  const [tier, setTier] = useState<string>('');
  const bulkTier = useBulkTier();
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
          <SelectItem value="C">⚪ Tier C</SelectItem>
          <SelectItem value="nurture">🔵 Nurture</SelectItem>
          <SelectItem value="clear"> -  clear tier</SelectItem>
        </SelectContent>
      </Select>
      <Button
        size="sm"
        disabled={tier === '' || bulkTier.isPending}
        onClick={() =>
          bulkTier.mutate(buildBody(tier === 'clear' ? null : (tier as LeadTier)), {
            onSuccess: ({ updated }) => {
              toast.success(`${updated} leads re-tiered`);
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
    </div>
  );
}
