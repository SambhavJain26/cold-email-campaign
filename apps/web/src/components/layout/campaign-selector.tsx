import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCampaigns } from '@/api/queries/campaigns';

/** Global campaign context (docs/11 §2): most screens are campaign-scoped;
 *  the selection lives in the URL as `?campaign=` so it survives reload/share. */
export function useCampaignParam(): number | undefined {
  const [searchParams] = useSearchParams();
  const raw = searchParams.get('campaign');
  const id = raw === null ? NaN : Number(raw);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export function resolveCampaignSelection(
  campaigns: ReadonlyArray<{ id: number }>,
  selected: number | undefined,
): number | undefined {
  return campaigns.some((campaign) => campaign.id === selected) ? selected : campaigns[0]?.id;
}

export function CampaignSelector() {
  const { data } = useCampaigns();
  const [searchParams, setSearchParams] = useSearchParams();
  const selected = useCampaignParam();

  const items = useMemo(() => data?.items ?? [], [data]);
  const effectiveSelected = resolveCampaignSelection(items, selected);
  const effectiveCampaign = items.find((campaign) => campaign.id === effectiveSelected);

  useEffect(() => {
    // An empty array before the campaigns query resolves is not evidence that
    // a deep-linked campaign is invalid. Clearing it here silently switches
    // analytics/leads/overview to the first campaign during initial load.
    if (data === undefined) return;
    if (selected === undefined || items.some((campaign) => campaign.id === selected)) return;
    const next = new URLSearchParams(searchParams);
    next.delete('campaign');
    setSearchParams(next, { replace: true });
  }, [data, items, searchParams, selected, setSearchParams]);

  return (
    <Select
      value={selected !== undefined ? String(selected) : ''}
      onValueChange={(value) => {
        const next = new URLSearchParams(searchParams);
        next.set('campaign', value);
        setSearchParams(next, { replace: true });
      }}
    >
      <SelectTrigger
        size="sm"
        className="min-h-11 min-w-0 flex-1 sm:w-56 sm:flex-none md:min-h-8"
        aria-label="Campaign"
      >
        <SelectValue placeholder={effectiveCampaign?.name ?? 'No campaigns'} />
      </SelectTrigger>
      <SelectContent>
        {items.map((campaign) => (
          <SelectItem key={campaign.id} value={String(campaign.id)}>
            {campaign.name}
            {campaign.status !== 'active' && (
              <span className="text-muted-foreground"> ({campaign.status})</span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
