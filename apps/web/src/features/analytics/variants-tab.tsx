import { useState } from 'react';
import { Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { useVariantAnalytics } from '@/api/queries/analytics';
import { useSequences } from '@/api/queries/sequences';
import { useDeactivateVariant } from '@/api/mutations/campaigns';
import { variantsMeetings, winningVariant } from './reconciliation';

const SMALL_SAMPLE = 300;

/** F7.1 — 13a variant comparison. The endpoint is sequence-scoped (not campaign-
 *  scoped), so the sequence is chosen here — defaulting to the campaign's own. */
export function VariantsTab({ campaignSequenceId }: { campaignSequenceId: number | null }) {
  const sequences = useSequences();
  const [sequenceId, setSequenceId] = useState<number | undefined>(undefined);
  const effectiveId = sequenceId ?? campaignSequenceId ?? sequences.data?.items[0]?.id ?? undefined;
  const { data, isPending, isError, refetch } = useVariantAnalytics(effectiveId ?? 0, 1);
  const deactivate = useDeactivateVariant();
  const [confirmId, setConfirmId] = useState<number | null>(null);

  if (effectiveId === undefined) {
    return <EmptyState title="No sequences yet" description="Variant analysis needs a sequence." />;
  }
  if (isPending) return <Skeleton className="h-40 w-full" />;
  if (isError) {
    return (
      <EmptyState title="Failed to load variants" actionLabel="Retry" onAction={() => refetch()} />
    );
  }

  const rows = data.items;
  const winner = winningVariant(rows);
  const smallSample = rows.some((row) => row.sent < SMALL_SAMPLE);
  const loser = rows.find((row) => row.variant_id !== winner?.variant_id);
  const confirmTarget = rows.find((row) => row.variant_id === confirmId);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Step-1 openers of</span>
        <Select value={String(effectiveId)} onValueChange={(value) => setSequenceId(Number(value))}>
          <SelectTrigger size="sm" className="w-64" aria-label="Sequence">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(sequences.data?.items ?? []).map((sequence) => (
              <SelectItem key={sequence.id} value={String(sequence.id)}>
                {sequence.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Variant</TableHead>
              <TableHead className="text-xs">Subject</TableHead>
              <TableHead className="text-right text-xs">Sent</TableHead>
              <TableHead className="text-right text-xs">Reply</TableHead>
              <TableHead className="text-right text-xs">Positive</TableHead>
              <TableHead className="text-right text-xs">Meetings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.variant_id}
                data-testid={`variant-row-${row.label}`}
                className={row.variant_id === winner?.variant_id ? 'bg-success/10' : undefined}
              >
                <TableCell className="py-1.5 text-sm font-medium">
                  {row.variant_id === winner?.variant_id && (
                    <Trophy className="mr-1 inline size-3.5 text-success" aria-label="winner" />
                  )}
                  {row.label}
                </TableCell>
                <TableCell className="py-1.5 font-mono text-xs text-muted-foreground">
                  {row.subject_template}
                </TableCell>
                <TableCell className="py-1.5 text-right text-sm tabular-nums">{row.sent}</TableCell>
                <TableCell
                  className="py-1.5 text-right text-sm tabular-nums"
                  title={`${row.reply_rate.numerator} / ${row.reply_rate.denominator} = ${row.reply_rate.value}%`}
                >
                  {row.reply_rate.value}%
                </TableCell>
                <TableCell
                  className="py-1.5 text-right text-sm tabular-nums"
                  title={`${row.positive_rate.numerator} / ${row.positive_rate.denominator} = ${row.positive_rate.value}%`}
                >
                  {row.positive_rate.value}%
                </TableCell>
                <TableCell className="py-1.5 text-right text-sm font-medium tabular-nums">
                  {row.meetings}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {winner && (
        <div className="space-y-1 text-xs" data-testid="variants-verdict">
          <p>
            🏆 Variant {winner.label} wins on meetings ({winner.meetings}) — the metric that matters
            more than raw replies.
          </p>
          <p className="text-muted-foreground">
            Meetings sum to {variantsMeetings(rows)} across these variants — counted only for leads
            who received one of these step-1 openers.
          </p>
          {smallSample && (
            <p className="text-warning" data-testid="small-sample">
              ⚠️ Under {SMALL_SAMPLE} sends per variant — trust big gaps, not small wobbles.
            </p>
          )}
        </div>
      )}

      {winner && loser && (
        <Button variant="outline" size="sm" onClick={() => setConfirmId(loser.variant_id)}>
          Deactivate {loser.label}, route all to {winner.label}
        </Button>
      )}

      <Dialog open={confirmId !== null} onOpenChange={(open) => !open && setConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate variant {confirmTarget?.label}?</DialogTitle>
            <DialogDescription>
              New sends stop using it. Already-sent messages keep their history, and the variant row
              is retired, never deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmId(null)}>
              Cancel
            </Button>
            <Button
              disabled={deactivate.isPending}
              onClick={() => {
                if (confirmId === null) return;
                deactivate.mutate(confirmId, {
                  onSuccess: () => {
                    toast.success(`Variant ${confirmTarget?.label} deactivated`);
                    setConfirmId(null);
                  },
                });
              }}
            >
              Deactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
