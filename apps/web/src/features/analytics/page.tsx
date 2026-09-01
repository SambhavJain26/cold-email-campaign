import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared/empty-state';
import { useCampaignParam } from '@/components/layout/campaign-selector';
import { useOverview } from '@/api/queries/analytics';
import { useCampaigns } from '@/api/queries/campaigns';
import { HealthTab } from './health-tab';
import { StepsTab } from './steps-tab';
import { TiersTab } from './tiers-tab';
import { VariantsTab } from './variants-tab';

/** F7.1–F7.4 — Analytics (docs/12 §8): the four §13 panels, campaign-scoped. */
export default function AnalyticsPage() {
  const campaigns = useCampaigns();
  const selected = useCampaignParam();
  const campaignId = selected ?? campaigns.data?.items[0]?.id;
  const overview = useOverview(campaignId ?? 0);
  const [tab, setTab] = useState('variants');
  const [searchParams, setSearchParams] = useSearchParams();

  if (campaigns.isPending) return <Skeleton className="m-6 h-64" />;
  if (campaignId === undefined) {
    return (
      <div className="p-6">
        <EmptyState
          title="No campaigns yet"
          description="Analytics reads the event log of one campaign at a time."
        />
      </div>
    );
  }

  // Campaign-level figures the tables reconcile against (same log, one query).
  const campaignPositives = overview.data?.positive_rate.numerator ?? null;
  const campaignMeetings = overview.data?.meetings.count ?? null;
  const campaignContacted = overview.data?.progress.contacted ?? null;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Analytics</h1>
        <Select
          value={String(campaignId)}
          onValueChange={(value) => {
            const next = new URLSearchParams(searchParams);
            next.set('campaign', value);
            setSearchParams(next, { replace: true });
          }}
        >
          <SelectTrigger size="sm" className="w-48" aria-label="Analytics campaign">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {(campaigns.data?.items ?? []).map((item) => (
                <SelectItem key={item.id} value={String(item.id)}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="max-w-full overflow-x-auto overflow-y-hidden">
          <TabsList className="min-w-max">
            <TabsTrigger value="variants">Variants</TabsTrigger>
            <TabsTrigger value="steps">Steps</TabsTrigger>
            <TabsTrigger value="tiers">Tiers</TabsTrigger>
            <TabsTrigger value="health">Health</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="variants" className="pt-4">
          <VariantsTab
            campaignId={campaignId}
            campaignSequenceId={
              campaigns.data?.items.find((item) => item.id === campaignId)?.sequence_id ?? null
            }
          />
        </TabsContent>
        <TabsContent value="steps" className="pt-4">
          <StepsTab
            campaignId={campaignId}
            sequenceId={
              campaigns.data?.items.find((item) => item.id === campaignId)?.sequence_id ?? null
            }
            campaignPositives={campaignPositives}
          />
        </TabsContent>
        <TabsContent value="tiers" className="pt-4">
          <TiersTab
            campaignId={campaignId}
            campaignMeetings={campaignMeetings}
            campaignContacted={campaignContacted}
          />
        </TabsContent>
        <TabsContent value="health" className="pt-4">
          <HealthTab campaignId={campaignId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
