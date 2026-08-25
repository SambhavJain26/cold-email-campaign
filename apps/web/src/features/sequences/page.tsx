import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Link, useNavigate } from 'react-router-dom';
import type { SequenceDto } from '@coldemail/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import { useCampaigns } from '@/api/queries/campaigns';
import { useSequences } from '@/api/queries/sequences';
import { useDeleteSequence } from '@/api/mutations/sequences';
import { ConfirmTypedDialog } from '@/components/shared/confirm-typed-dialog';

/** "0 / 3 / 4 / 5 days" — the wait pattern the walkthrough's step cards show. */
function waitPattern(sequence: SequenceDto): string {
  return `${[...sequence.steps]
    .sort((a, b) => a.step_no - b.step_no)
    .map((s) => s.wait_days)
    .join(' / ')} days`;
}

function activeVariantCount(sequence: SequenceDto): number {
  return sequence.steps.reduce((sum, s) => sum + s.variants.filter((v) => v.active).length, 0);
}

/** F4.1 — Sequences list (docs/12 §5): name, steps, stop conditions, campaigns using it. */
export default function SequencesPage() {
  const navigate = useNavigate();
  const { data, isPending, isError, refetch } = useSequences();
  const campaigns = useCampaigns();
  const remove = useDeleteSequence();
  const [deleteId, setDeleteId] = useState<number | null>(null);

  if (isPending) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title="Failed to load sequences"
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      </div>
    );
  }

  const sequences = data.items;
  const columns: Array<DataTableColumn<SequenceDto>> = [
    {
      key: 'name',
      header: 'Name',
      cell: (sequence) => (
        <Link to={`/sequences/${sequence.id}`} className="font-medium hover:underline">
          {sequence.name}
        </Link>
      ),
    },
    { key: 'steps', header: 'Steps', align: 'right', cell: (sequence) => sequence.steps.length },
    { key: 'variants', header: 'Active variants', align: 'right', cell: activeVariantCount },
    {
      key: 'waits',
      header: 'Waits',
      cell: (sequence) => (
        <span className="text-xs text-muted-foreground tabular-nums">{waitPattern(sequence)}</span>
      ),
    },
    {
      key: 'stops',
      header: 'Stop conditions',
      cell: (sequence) => (
        <div className="flex flex-wrap justify-end gap-1 md:justify-start">
          {sequence.stop_on_reply && (
            <Badge variant="secondary" className="text-[10px]">
              reply
            </Badge>
          )}
          <Badge variant="secondary" className="text-[10px]">
            hard bounce / STOP
          </Badge>
        </div>
      ),
    },
    {
      key: 'used',
      header: 'Used by',
      cell: (sequence) => {
        const users = (campaigns.data?.items ?? []).filter(
          (campaign) => campaign.sequence_id === sequence.id,
        );
        return users.length === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <div className="flex flex-wrap justify-end gap-1 md:justify-start">
            {users.map((campaign) => (
              <Badge
                key={campaign.id}
                variant="outline"
                className="text-[10px]"
                title={`status: ${campaign.status}`}
              >
                {campaign.name}
              </Badge>
            ))}
          </div>
        );
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (sequence) => (
        <div className="flex flex-wrap justify-end gap-1">
          <Button variant="ghost" size="xs" asChild>
            <Link to={`/sequences/${sequence.id}`}>Open</Link>
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setDeleteId(sequence.id)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Sequences</h1>
          <p className="text-xs text-muted-foreground">All campaigns</p>
        </div>
        <Button size="sm" onClick={() => navigate('/sequences/new')}>
          <Plus className="size-4" /> New Sequence
        </Button>
      </div>

      {sequences.length === 0 ? (
        <EmptyState
          title="No sequences yet"
          description="A sequence defines the steps, waits and templates a campaign sends."
          actionLabel="New Sequence"
          onAction={() => navigate('/sequences/new')}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={sequences}
          rowKey={(sequence) => sequence.id}
          rowTestId={(sequence) => `sequence-row-${sequence.id}`}
        />
      )}
      {deleteId !== null &&
        (() => {
          const sequence = sequences.find((s) => s.id === deleteId);
          if (!sequence) return null;
          return (
            <ConfirmTypedDialog
              open
              onOpenChange={(open) => !open && setDeleteId(null)}
              title="Delete sequence"
              description="Deletion is allowed only while this sequence has no campaign, event, or sent-content history. Type its name to confirm."
              expected={sequence.name}
              confirmLabel="Delete sequence"
              pending={remove.isPending}
              onConfirm={(typed) =>
                remove.mutate(
                  { id: sequence.id, confirm: typed },
                  {
                    onSuccess: () => {
                      toast.success(`${sequence.name} deleted`);
                      setDeleteId(null);
                    },
                  },
                )
              }
            />
          );
        })()}
    </div>
  );
}
