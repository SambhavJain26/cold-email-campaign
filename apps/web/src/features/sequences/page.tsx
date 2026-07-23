import { Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { SequenceDto } from '@coldemail/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/shared/empty-state';
import { useCampaigns } from '@/api/queries/campaigns';
import { useSequences } from '@/api/queries/sequences';

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

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Sequences</h1>
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
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-right text-xs">Steps</TableHead>
                <TableHead className="text-right text-xs">Active variants</TableHead>
                <TableHead className="text-xs">Waits</TableHead>
                <TableHead className="text-xs">Stop conditions</TableHead>
                <TableHead className="text-xs">Used by</TableHead>
                <TableHead className="text-right text-xs">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sequences.map((sequence) => {
                const users = (campaigns.data?.items ?? []).filter(
                  (c) => c.sequence_id === sequence.id,
                );
                return (
                  <TableRow key={sequence.id} data-testid={`sequence-row-${sequence.id}`}>
                    <TableCell className="py-1.5">
                      <Link
                        to={`/sequences/${sequence.id}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {sequence.name}
                      </Link>
                    </TableCell>
                    <TableCell className="py-1.5 text-right text-sm tabular-nums">
                      {sequence.steps.length}
                    </TableCell>
                    <TableCell className="py-1.5 text-right text-sm tabular-nums">
                      {activeVariantCount(sequence)}
                    </TableCell>
                    <TableCell className="py-1.5 text-xs text-muted-foreground tabular-nums">
                      {waitPattern(sequence)}
                    </TableCell>
                    <TableCell className="py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {sequence.stop_on_reply && (
                          <Badge variant="secondary" className="text-[10px]">
                            reply
                          </Badge>
                        )}
                        {sequence.stop_on_hard_bounce && (
                          <Badge variant="secondary" className="text-[10px]">
                            hard bounce
                          </Badge>
                        )}
                        {sequence.stop_on_unsubscribe && (
                          <Badge variant="secondary" className="text-[10px]">
                            unsubscribe
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-1.5">
                      {users.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {users.map((c) => (
                            <Badge
                              key={c.id}
                              variant="outline"
                              className="text-[10px]"
                              title={`status: ${c.status}`}
                            >
                              {c.name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="py-1.5 text-right">
                      <Button variant="ghost" size="xs" asChild>
                        <Link to={`/sequences/${sequence.id}`}>Open</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
