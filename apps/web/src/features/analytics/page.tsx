import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
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
  const campaign = campaigns.data?.items.find((c) => c.id === campaignId);
  const overview = useOverview(campaignId ?? 0);
  const [tab, setTab] = useState('variants');

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
    <div className="space-y-4 p-6">
      <div className="flex items-baseline gap-2">
        <h1 className="text-lg font-semibold">Analytics</h1>
        {campaign && <span className="text-sm text-muted-foreground">· {campaign.name}</span>}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="variants">Variants</TabsTrigger>
          <TabsTrigger value="steps">Steps</TabsTrigger>
          <TabsTrigger value="tiers">Tiers</TabsTrigger>
          <TabsTrigger value="health">Health</TabsTrigger>
        </TabsList>

        <TabsContent value="variants" className="pt-4">
          <VariantsTab campaignSequenceId={campaign?.sequence_id ?? null} />
        </TabsContent>
        <TabsContent value="steps" className="pt-4">
          <StepsTab
            campaignId={campaignId}
            sequenceId={campaign?.sequence_id ?? null}
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
