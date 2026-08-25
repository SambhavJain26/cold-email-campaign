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

export function CampaignSelector() {
  const { data } = useCampaigns();
  const [searchParams, setSearchParams] = useSearchParams();
  const selected = useCampaignParam();

  const items = useMemo(() => data?.items ?? [], [data]);

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
        <SelectValue placeholder={items.length === 0 ? 'No campaigns' : 'Select campaign…'} />
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
