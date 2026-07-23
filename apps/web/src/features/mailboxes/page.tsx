import { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { MailboxDto } from '@coldemail/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/shared/empty-state';
import { formatRelativeTime } from '@/lib/format';
import { useMailboxes } from '@/api/queries/mailboxes';
import { usePauseMailbox, useResumeMailbox } from '@/api/mutations/mailboxes';
import { FailurePanels } from './failure-panels';
import { MailboxDialog } from './mailbox-dialog';
import { MailboxStatusChip } from './status-chip';
import { VolumeChart } from './volume-chart';

/** F2.1 - Mailboxes (docs/12 §4): table + totals, failure panels, volume chart. */
export default function MailboxesPage() {
  const { data, isPending, isError, refetch } = useMailboxes();
  const pause = usePauseMailbox();
  const resume = useResumeMailbox();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MailboxDto | undefined>(undefined);

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
          title="Failed to load mailboxes"
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      </div>
    );
  }

  const mailboxes = data.items;
  const totalCapacity = mailboxes.reduce((sum, m) => sum + m.effective_cap, 0);

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Mailboxes</h1>
        <Button
          size="sm"
          onClick={() => {
            setEditing(undefined);
            setDialogOpen(true);
          }}
        >
          <Plus className="size-4" /> Add Mailbox
        </Button>
      </div>

      <FailurePanels mailboxes={mailboxes} />

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Address</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-right text-xs">Sent today</TableHead>
              <TableHead className="text-right text-xs">7-day avg</TableHead>
              <TableHead className="text-right text-xs">Hard-bnc %</TableHead>
              <TableHead className="text-xs">Last poll</TableHead>
              <TableHead className="text-right text-xs">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mailboxes.map((mailbox) => (
              <TableRow key={mailbox.id}>
                <TableCell className="py-1.5">
                  <p className="text-sm font-medium">{mailbox.from_address}</p>
                  <p className="text-xs text-muted-foreground">{mailbox.display_name}</p>
                </TableCell>
                <TableCell className="py-1.5">
                  <MailboxStatusChip status={mailbox.status} />
                </TableCell>
                <TableCell className="py-1.5 text-right text-sm tabular-nums">
                  {mailbox.sent_today}/{mailbox.effective_cap}
                </TableCell>
                <TableCell className="py-1.5 text-right text-sm tabular-nums">
                  {mailbox.seven_day_avg.toFixed(1)}
                </TableCell>
                <TableCell className="py-1.5 text-right text-sm tabular-nums">
                  {mailbox.hard_bounce_pct.toFixed(1)}%
                </TableCell>
                <TableCell className="py-1.5 text-xs text-muted-foreground">
                  {mailbox.last_successful_poll_at
                    ? formatRelativeTime(mailbox.last_successful_poll_at)
                    : 'never'}
                </TableCell>
                <TableCell className="py-1.5 text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => {
                        setEditing(mailbox);
                        setDialogOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                    {mailbox.status === 'paused' ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={resume.isPending}
                        onClick={() =>
                          resume.mutate(
                            { id: mailbox.id },
                            { onSuccess: () => toast.success('Mailbox resumed') },
                          )
                        }
                      >
                        Resume
                      </Button>
                    ) : (
                      mailbox.status === 'ok' && (
                        <Button
                          variant="ghost"
                          size="xs"
                          disabled={pause.isPending}
                          onClick={() =>
                            pause.mutate(mailbox.id, {
                              onSuccess: () => toast.success('Mailbox paused'),
                            })
                          }
                        >
                          Pause
                        </Button>
                      )
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="text-xs font-medium">TOTAL DAILY CAPACITY</TableCell>
              <TableCell />
              <TableCell
                className="text-right text-sm font-semibold tabular-nums"
                data-testid="total-capacity"
              >
                {totalCapacity}
              </TableCell>
              <TableCell colSpan={4} />
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      <VolumeChart mailboxes={mailboxes} />

      <MailboxDialog open={dialogOpen} onOpenChange={setDialogOpen} mailbox={editing} />
    </div>
  );
}
