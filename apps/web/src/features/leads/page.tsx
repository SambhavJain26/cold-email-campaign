import { useDeferredValue, useState } from 'react';
import { Plus, Upload } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { ENROLLMENT_STATES, type LeadDto, type LeadTier } from '@coldemail/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { ResponsiveFilters } from '@/components/shared/responsive-filters';
import { StateBadge } from '@/components/shared/state-badge';
import { TierBadge } from '@/components/shared/tier-badge';
import { useCampaignParam } from '@/components/layout/campaign-selector';
import { useLeads, type LeadsQuery } from '@/api/queries/leads';
import { BulkTierBar } from './bulk-tier-bar';
import { AddLeadDialog } from './add-lead-dialog';
import { ImportWizard } from './import-wizard';
import { TierHeader } from './tier-header';

const ANY = '__any__';

/** F3.1/F3.2 — Leads list (docs/12 §2). */
export default function LeadsPage() {
  const navigate = useNavigate();
  const campaignId = useCampaignParam();
  const [page, setPage] = useState(1);
  const [tier, setTier] = useState<string>(ANY);
  const [state, setState] = useState<string>(ANY);
  const [search, setSearch] = useState('');
  const [suppressedOnly, setSuppressedOnly] = useState(false);
  const q = useDeferredValue(search);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const query: LeadsQuery = {
    page,
    per_page: 50,
    tier: tier === ANY ? undefined : tier,
    state: state === ANY ? undefined : state,
    campaign_id: campaignId,
    q: q === '' ? undefined : q,
    suppressed: suppressedOnly ? true : undefined,
  };
  const { data, isPending, isError, refetch } = useLeads(query);

  const clearSelection = () => {
    setSelected(new Set());
    setAllMatching(false);
  };
  const setFilter = (apply: () => void) => {
    apply();
    setPage(1);
    clearSelection();
  };

  const pageIds = (data?.items ?? []).map((l) => l.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const columns: Array<DataTableColumn<LeadDto>> = [
    {
      key: 'select',
      header: (
        <Checkbox
          aria-label="Select page"
          checked={allPageSelected}
          onCheckedChange={(checked) => {
            setAllMatching(false);
            setSelected((prev) => {
              const next = new Set(prev);
              for (const id of pageIds) {
                if (checked === true) next.add(id);
                else next.delete(id);
              }
              return next;
            });
          }}
        />
      ),
      cell: (lead) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Checkbox
            aria-label={`Select ${lead.email}`}
            checked={allMatching || selected.has(lead.id)}
            onCheckedChange={(checked) => {
              setAllMatching(false);
              setSelected((prev) => {
                const next = new Set(prev);
                if (checked === true) next.add(lead.id);
                else next.delete(lead.id);
                return next;
              });
            }}
          />
        </span>
      ),
      className: 'w-8',
    },
    { key: 'email', header: 'Email', cell: (l) => l.email },
    {
      key: 'name',
      header: 'Name',
      cell: (l) => [l.first_name, l.last_name].filter(Boolean).join(' ') || '—',
    },
    { key: 'company', header: 'Company', cell: (l) => l.company ?? '—' },
    {
      key: 'location',
      header: 'Location',
      cell: (l) => [l.city, l.state].filter(Boolean).join(', ') || '—',
    },
    { key: 'tier', header: 'Tier', cell: (l) => <TierBadge tier={l.tier} /> },
    {
      key: 'state',
      header: 'State',
      cell: (l) =>
        l.latest_enrollment ? <StateBadge state={l.latest_enrollment.current_state} /> : '—',
    },
    {
      key: 'suppressed',
      header: '',
      cell: (l) => (l.is_suppressed ? <span title="Suppressed">🚫</span> : null),
      className: 'w-8',
    },
  ];

  if (isPending) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="p-6">
        <EmptyState title="Failed to load leads" actionLabel="Retry" onAction={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Leads</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" /> Add lead
          </Button>
          <Button size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="size-4" /> Import CSV
          </Button>
        </div>
      </div>
      <AddLeadDialog open={addOpen} onOpenChange={setAddOpen} />

      <TierHeader total={data.total} untiered={data.untiered_count} />

      {data.untiered_count > 0 && (
        <div
          className="flex items-center justify-between rounded-lg border border-info/40 bg-info/10 px-4 py-2 text-sm"
          data-testid="untiered-banner"
        >
          <p>
            <span className="font-semibold tabular-nums">{data.untiered_count}</span> leads need
            tiering before they can be prioritized.
          </p>
          <Button size="sm" variant="outline" onClick={() => setFilter(() => setTier('untiered'))}>
            Bulk tag
          </Button>
        </div>
      )}

      <ResponsiveFilters
        activeCount={
          Number(tier !== ANY) +
          Number(state !== ANY) +
          Number(search !== '') +
          Number(suppressedOnly)
        }
        description="Filter by tier, enrollment state, search text, or suppression status."
      >
        <Select value={tier} onValueChange={(v) => setFilter(() => setTier(v))}>
          <SelectTrigger size="sm" className="w-32" aria-label="Tier filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All tiers</SelectItem>
            <SelectItem value="A">🟢 Tier A</SelectItem>
            <SelectItem value="B">🟡 Tier B</SelectItem>
            <SelectItem value="C">⚪ Tier C</SelectItem>
            <SelectItem value="nurture">🔵 Nurture</SelectItem>
            <SelectItem value="untiered">Untiered</SelectItem>
          </SelectContent>
        </Select>
        <Select value={state} onValueChange={(v) => setFilter(() => setState(v))}>
          <SelectTrigger size="sm" className="w-36" aria-label="State filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All states</SelectItem>
            {ENROLLMENT_STATES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Search email, name, company…"
          className="h-8 w-64"
          value={search}
          onChange={(e) => setFilter(() => setSearch(e.target.value))}
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch
            checked={suppressedOnly}
            onCheckedChange={(v) => setFilter(() => setSuppressedOnly(v))}
            aria-label="Suppressed only"
          />
          Suppressed only
        </label>
      </ResponsiveFilters>

      {(selected.size > 0 || allMatching) && (
        <BulkTierBar
          selectedCount={selected.size}
          allMatching={allMatching}
          matchingTotal={data.total}
          buildBody={(tierValue: LeadTier | null) =>
            allMatching
              ? {
                  tier: tierValue,
                  filter: {
                    // Select only offers contract values — safe narrowing.
                    tier: query.tier as LeadTier | 'untiered' | undefined,
                    state: query.state,
                    campaign_id: query.campaign_id,
                    q: query.q,
                    suppressed: query.suppressed,
                  },
                }
              : { tier: tierValue, lead_ids: [...selected] }
          }
          onDone={clearSelection}
        />
      )}

      {allPageSelected && !allMatching && data.total > pageIds.length && (
        <button
          className="text-sm text-info underline-offset-2 hover:underline"
          onClick={() => setAllMatching(true)}
          data-testid="select-all-matching"
        >
          Select all {data.total} leads matching the current filter
        </button>
      )}

      <DataTable
        columns={columns}
        rows={data.items}
        rowKey={(l) => l.id}
        onRowClick={(l) => navigate(`/leads/${l.id}`)}
        pagination={{
          page: data.page,
          perPage: data.per_page,
          total: data.total,
          onPageChange: setPage,
        }}
        mobileCard={(lead) => (
          <article className="space-y-3 rounded-lg border border-border bg-card p-4">
            <div className="flex min-w-0 items-start gap-3">
              <span onClick={(event) => event.stopPropagation()}>
                <Checkbox
                  aria-label={`Select ${lead.email}`}
                  checked={allMatching || selected.has(lead.id)}
                  onCheckedChange={(checked) => {
                    setAllMatching(false);
                    setSelected((previous) => {
                      const next = new Set(previous);
                      if (checked === true) next.add(lead.id);
                      else next.delete(lead.id);
                      return next;
                    });
                  }}
                />
              </span>
              <div className="min-w-0 flex-1">
                <Link
                  to={`/leads/${lead.id}`}
                  className="inline-flex min-h-11 items-center break-all text-sm font-medium underline-offset-2 hover:underline"
                >
                  {lead.email}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {[lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'No name'}
                  {lead.company ? ` · ${lead.company}` : ''}
                </p>
              </div>
              {lead.is_suppressed && <span title="Suppressed">🚫</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <TierBadge tier={lead.tier} />
              {lead.latest_enrollment && (
                <StateBadge state={lead.latest_enrollment.current_state} />
              )}
              {[lead.city, lead.state].filter(Boolean).length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {[lead.city, lead.state].filter(Boolean).join(', ')}
                </span>
              )}
            </div>
          </article>
        )}
        emptyTitle="No leads match this filter"
      />

      <ImportWizard open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
