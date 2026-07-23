import { useCallback, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared/empty-state';
import { useCompliance, useSettings } from '@/api/queries/settings';
import { AccountTab } from './account-tab';
import { ComplianceTab } from './compliance-tab';
import { RulesTab } from './rules-tab';

/** F2.5–F2.7 — Settings (docs/12 §10): rules | compliance | account tabs,
 *  with a dirty-state guard on tab switch. */
export default function SettingsPage() {
  const settings = useSettings();
  const compliance = useCompliance();
  const [tab, setTab] = useState('rules');
  const [dirtyTabs, setDirtyTabs] = useState<Record<string, boolean>>({});

  const setDirty = useCallback(
    (name: string) => (dirty: boolean) =>
      setDirtyTabs((prev) => (prev[name] === dirty ? prev : { ...prev, [name]: dirty })),
    [],
  );

  const onTabChange = (next: string) => {
    if (dirtyTabs[tab] && !window.confirm('You have unsaved changes on this tab. Discard them?')) {
      return;
    }
    setTab(next);
  };

  if (settings.isPending || compliance.isPending) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (settings.isError || compliance.isError) {
    return (
      <div className="p-6">
        <EmptyState
          title="Failed to load settings"
          actionLabel="Retry"
          onAction={() => {
            void settings.refetch();
            void compliance.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-4 p-6">
      <h1 className="text-lg font-semibold">Settings</h1>
      <Tabs value={tab} onValueChange={onTabChange}>
        <TabsList>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
        </TabsList>
        <TabsContent value="rules" className="pt-3">
          <RulesTab settings={settings.data} onDirtyChange={setDirty('rules')} />
        </TabsContent>
        <TabsContent value="compliance" className="pt-3">
          <ComplianceTab compliance={compliance.data} onDirtyChange={setDirty('compliance')} />
        </TabsContent>
        <TabsContent value="account" className="pt-3">
          <AccountTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
