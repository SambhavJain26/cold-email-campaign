import { useState } from 'react';
import type { CampaignDto } from '@coldemail/shared';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import { CollectionPagination } from '@/components/shared/collection-pagination';
import { EmptyState } from '@/components/shared/empty-state';
import {
  useAddPoolLeads,
  usePatchAutoEnrollment,
  usePatchCampaign,
  useReassignPoolLeads,
  useReleasePoolLeads,
} from '@/api/mutations/campaigns';
import { useAutoEnrollmentRuns, useCampaignPool, useCampaigns } from '@/api/queries/campaigns';

type PoolStatus = 'available' | 'enrolled' | 'released';

export function LeadPoolPanel({ campaign }: { campaign: CampaignDto }) {
  const [page, setPage] = useState(1);
  const [runPage, setRunPage] = useState(1);
  const [status, setStatus] = useState<PoolStatus | undefined>();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [addCount, setAddCount] = useState(1);
  const [targetCampaignId, setTargetCampaignId] = useState<number>();
  const [enableOpen, setEnableOpen] = useState(false);
  const [steadyCap, setSteadyCap] = useState(campaign.steady_daily_enroll_cap);
  const pool = useCampaignPool(campaign.id, page, status);
  const campaigns = useCampaigns();
  const runs = useAutoEnrollmentRuns(campaign.id, runPage);
  const add = useAddPoolLeads();
  const release = useReleasePoolLeads();
  const reassign = useReassignPoolLeads();
  const auto = usePatchAutoEnrollment();
  const patch = usePatchCampaign();
  const editable = campaign.status === 'draft' || campaign.status === 'paused';
  const toggle = (leadId: number, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(leadId);
      else next.delete(leadId);
      return next;
    });
  const columns: Array<DataTableColumn<NonNullable<typeof pool.data>['items'][number]>> = [
    {
      key: 'select',
      header: <span className="sr-only">Select</span>,
      cell: (item) =>
        editable && item.status === 'available' ? (
          <Checkbox
            aria-label={`Select ${item.lead.email}`}
            checked={selected.has(item.lead.id)}
            onCheckedChange={(checked) => toggle(item.lead.id, checked === true)}
          />
        ) : null,
      className: 'w-10',
      hideOnMobile: true,
    },
    {
      key: 'lead',
      header: 'Lead',
      cell: (item) => (
        <div>
          <p>{item.lead.email}</p>
          <p className="text-xs text-muted-foreground">{item.lead.company ?? '—'}</p>
        </div>
      ),
    },
    { key: 'tier', header: 'Tier', cell: (item) => item.lead.tier ?? 'Untiered' },
    {
      key: 'status',
      header: 'Status',
      cell: (item) => <Badge variant="outline">{item.status}</Badge>,
    },
    {
      key: 'source',
      header: 'Source',
      cell: (item) => (item.source_import_id ? `Import #${item.source_import_id}` : 'Global'),
    },
    {
      key: 'eligibility',
      header: 'Eligibility',
      cell: (item) => item.last_eligibility_reason ?? 'Ready',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Campaign lead pool</CardTitle>
        <CardDescription>
          Reserved leads stay separate from the global list. Pooling never enrolls or sends them.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {(
            [
              ['Total', campaign.pool_summary.total],
              ['Available', campaign.pool_summary.available],
              ['Enrolled', campaign.pool_summary.enrolled],
              ['Released', campaign.pool_summary.released],
              ['Needs recheck', campaign.pool_summary.temporarily_ineligible],
              ['Source imports', campaign.pool_summary.source_imports],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-4 rounded-md border border-border p-3 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="auto-enrollment">Automatic daily enrollment</Label>
                <p className="text-xs text-muted-foreground">
                  Once daily after local midnight. Missed days never accumulate.
                </p>
              </div>
              <Switch
                id="auto-enrollment"
                checked={campaign.auto_enroll_enabled}
                disabled={auto.isPending || campaign.status === 'archived'}
                onCheckedChange={(checked) => {
                  if (checked) setEnableOpen(true);
                  else
                    auto.mutate(
                      { campaignId: campaign.id, enabled: false },
                      { onSuccess: () => toast.success('Automatic enrollment disabled') },
                    );
                }}
              />
            </div>
            {campaign.last_auto_enrollment_run && (
              <p className="text-xs text-muted-foreground">
                Last run {campaign.last_auto_enrollment_run.local_date}:{' '}
                {campaign.last_auto_enrollment_run.enrolled} enrolled ·{' '}
                {campaign.last_auto_enrollment_run.status}
              </p>
            )}
            {campaign.auto_enroll_enabled && (
              <p className="text-xs text-muted-foreground">
                Next daily run: the first scheduler check after midnight in the application
                timezone. Paused campaigns are skipped and missed days never accumulate.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="steady-cap">Permanent enrollment cap after ramp</Label>
            <div className="flex gap-2">
              <Input
                id="steady-cap"
                type="number"
                min={1}
                value={steadyCap}
                onChange={(event) => setSteadyCap(Number(event.target.value))}
              />
              <Button
                variant="outline"
                disabled={
                  patch.isPending ||
                  steadyCap < 1 ||
                  (campaign.first_activated_at !== null &&
                    steadyCap > campaign.steady_daily_enroll_cap)
                }
                onClick={() =>
                  patch.mutate(
                    { id: campaign.id, body: { steady_daily_enroll_cap: steadyCap } },
                    { onSuccess: () => toast.success('Permanent cap saved') },
                  )
                }
              >
                Save cap
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              After first activation this value may only be lowered, never increased.
            </p>
          </div>
        </div>

        {runs.data && runs.data.total > 0 && (
          <section className="space-y-2 rounded-md border border-border p-3">
            <div>
              <h3 className="text-sm font-medium">Automatic enrollment history</h3>
              <p className="text-xs text-muted-foreground">
                Each attempted run records its trigger, local date, outcome, and enrolled count.
              </p>
            </div>
            <div className="space-y-2">
              {runs.data.items.map((run) => (
                <div
                  key={run.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs"
                >
                  <span>
                    {run.local_date} · {run.trigger}
                  </span>
                  <span>
                    {run.enrolled} enrolled · {run.status}
                  </span>
                </div>
              ))}
            </div>
            <CollectionPagination
              page={runs.data.page}
              perPage={runs.data.per_page}
              total={runs.data.total}
              onPageChange={setRunPage}
              paginationLabel="Automatic enrollment history pagination"
            />
          </section>
        )}

        {editable && (
          <div className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="pool-add-count">Add next safe global leads</Label>
              <Input
                id="pool-add-count"
                type="number"
                min={1}
                value={addCount}
                onChange={(event) => setAddCount(Number(event.target.value))}
              />
            </div>
            <Button
              disabled={add.isPending || addCount < 1}
              onClick={() =>
                add.mutate(
                  { campaignId: campaign.id, count: addCount },
                  {
                    onSuccess: (result) => toast.success(`${result.changed} leads reserved`),
                  },
                )
              }
            >
              Add to pool
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={status ?? 'all'}
            onValueChange={(value) => {
              setStatus(value === 'all' ? undefined : (value as PoolStatus));
              setPage(1);
              setSelected(new Set());
            }}
          >
            <SelectTrigger className="w-44" aria-label="Pool status filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All pool leads</SelectItem>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="enrolled">Enrolled</SelectItem>
                <SelectItem value="released">Released</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          {editable && selected.size > 0 && (
            <>
              <Button
                variant="outline"
                disabled={release.isPending}
                onClick={() =>
                  release.mutate(
                    { campaignId: campaign.id, leadIds: [...selected] },
                    {
                      onSuccess: (result) => {
                        toast.success(`${result.changed} leads released`);
                        setSelected(new Set());
                      },
                    },
                  )
                }
              >
                Release selected
              </Button>
              <Select
                value={targetCampaignId ? String(targetCampaignId) : ''}
                onValueChange={(value) => setTargetCampaignId(Number(value))}
              >
                <SelectTrigger className="w-48" aria-label="Reassignment target campaign">
                  <SelectValue placeholder="Reassign to…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {(campaigns.data?.items ?? [])
                      .filter(
                        (item) =>
                          item.id !== campaign.id &&
                          (item.status === 'draft' || item.status === 'paused'),
                      )
                      .map((item) => (
                        <SelectItem key={item.id} value={String(item.id)}>
                          {item.name}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                disabled={!targetCampaignId || reassign.isPending}
                onClick={() =>
                  reassign.mutate(
                    {
                      campaignId: campaign.id,
                      targetCampaignId: targetCampaignId!,
                      leadIds: [...selected],
                    },
                    {
                      onSuccess: (result) => {
                        toast.success(`${result.changed} leads reassigned`);
                        setSelected(new Set());
                      },
                    },
                  )
                }
              >
                Reassign
              </Button>
            </>
          )}
        </div>

        {pool.isPending ? (
          <p className="text-sm text-muted-foreground">Loading campaign pool…</p>
        ) : pool.isError ? (
          <EmptyState
            title="Pool unavailable"
            actionLabel="Retry"
            onAction={() => pool.refetch()}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={pool.data.items}
            rowKey={(item) => item.id}
            emptyTitle="No leads in this pool view"
            pagination={{
              page: pool.data.page,
              perPage: pool.data.per_page,
              total: pool.data.total,
              onPageChange: (next) => {
                setPage(next);
                setSelected(new Set());
              },
              paginationLabel: 'Campaign pool pagination',
            }}
            mobileCard={(item) => (
              <Card>
                <CardContent className="flex gap-3 p-3">
                  {editable && item.status === 'available' && (
                    <Checkbox
                      aria-label={`Select ${item.lead.email}`}
                      checked={selected.has(item.lead.id)}
                      onCheckedChange={(checked) => toggle(item.lead.id, checked === true)}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.lead.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.lead.tier ?? 'Untiered'} · {item.status} ·{' '}
                      {item.last_eligibility_reason ?? 'Ready'}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          />
        )}

        <Dialog open={enableOpen} onOpenChange={setEnableOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Enable automatic daily enrollment?</DialogTitle>
              <DialogDescription>
                If this campaign is active, the application will immediately enroll up to today’s
                remaining safe capacity. It will then run once per local day. This does not bypass
                mailbox caps, follow-up reservations, suppression, or pacing.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEnableOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={auto.isPending}
                onClick={() =>
                  auto.mutate(
                    { campaignId: campaign.id, enabled: true },
                    {
                      onSuccess: (result) => {
                        toast.success(
                          result.run
                            ? `Automatic enrollment enabled; ${result.run.enrolled} enrolled now`
                            : 'Automatic enrollment armed',
                        );
                        setEnableOpen(false);
                      },
                    },
                  )
                }
              >
                Enable automatic enrollment
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
