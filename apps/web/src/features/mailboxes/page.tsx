import { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { MailboxDto } from '@coldemail/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import { formatRelativeTime } from '@/lib/format';
import { useMailboxes } from '@/api/queries/mailboxes';
import {
  useDisconnectGoogleOauth,
  usePauseMailbox,
  useResumeMailbox,
  useStartGoogleOauth,
} from '@/api/mutations/mailboxes';
import { FailurePanels } from './failure-panels';
import { MailboxDialog } from './mailbox-dialog';
import { MailboxStatusChip } from './status-chip';
import { VolumeChart } from './volume-chart';

/** F2.1 — Mailboxes (docs/12 §4): table + totals, failure panels, volume chart. */
export default function MailboxesPage() {
  const { data, isPending, isError, refetch } = useMailboxes();
  const pause = usePauseMailbox();
  const resume = useResumeMailbox();
  const startGoogle = useStartGoogleOauth();
  const disconnectGoogle = useDisconnectGoogleOauth();
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
  const columns: Array<DataTableColumn<MailboxDto>> = [
    {
      key: 'address',
      header: 'Address',
      cell: (mailbox) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{mailbox.from_address}</p>
          <p className="truncate text-xs text-muted-foreground">{mailbox.display_name}</p>
          <p className="text-[11px] text-muted-foreground">
            {mailbox.auth_type === 'google_oauth'
              ? mailbox.oauth_connected
                ? 'Google OAuth connected'
                : 'Google OAuth'
              : 'App password'}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (mailbox) => <MailboxStatusChip status={mailbox.status} />,
    },
    {
      key: 'sent',
      header: 'Sent today',
      align: 'right',
      cell: (mailbox) => `${mailbox.sent_today}/${mailbox.effective_cap}`,
    },
    {
      key: 'average',
      header: '7-day avg',
      align: 'right',
      cell: (mailbox) => mailbox.seven_day_avg.toFixed(1),
    },
    {
      key: 'bounce',
      header: 'Hard-bnc %',
      align: 'right',
      cell: (mailbox) => `${mailbox.hard_bounce_pct.toFixed(1)}%`,
    },
    {
      key: 'poll',
      header: 'Last poll',
      cell: (mailbox) => (
        <span className="text-xs text-muted-foreground">
          {mailbox.last_successful_poll_at
            ? formatRelativeTime(mailbox.last_successful_poll_at)
            : 'never'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (mailbox) => (
        <div className="flex flex-wrap justify-end gap-1">
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
          {mailbox.auth_type === 'google_oauth' &&
            (!mailbox.oauth_connected || mailbox.status === 'auth_failed') && (
              <Button
                variant="outline"
                size="xs"
                disabled={startGoogle.isPending}
                onClick={() => startGoogle.mutate(mailbox.id)}
              >
                {mailbox.oauth_connected ? 'Reconnect Google' : 'Connect Google'}
              </Button>
            )}
          {mailbox.auth_type === 'google_oauth' && mailbox.oauth_connected && (
            <Button
              variant="ghost"
              size="xs"
              disabled={disconnectGoogle.isPending}
              onClick={() => {
                if (!window.confirm(`Disconnect Google authorization for ${mailbox.from_address}?`))
                  return;
                disconnectGoogle.mutate(mailbox.id, {
                  onSuccess: () => toast.success('Google authorization disconnected'),
                });
              }}
            >
              Disconnect
            </Button>
          )}
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
      ),
    },
  ];

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Mailboxes</h1>
          <p className="text-xs text-muted-foreground">All campaigns</p>
        </div>
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

      <DataTable columns={columns} rows={mailboxes} rowKey={(mailbox) => mailbox.id} />
      <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm">
        <span className="font-medium">Total daily capacity</span>
        <span className="font-semibold tabular-nums" data-testid="total-capacity">
          {totalCapacity}
        </span>
      </div>

      <VolumeChart mailboxes={mailboxes} />

      <MailboxDialog open={dialogOpen} onOpenChange={setDialogOpen} mailbox={editing} />
    </div>
  );
}
