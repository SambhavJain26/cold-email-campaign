import { useState } from 'react';
import { Link } from 'react-router-dom';
import { INCOMING_CLASSES, type IncomingClass } from '@coldemail/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { DataTable } from '@/components/shared/data-table';
import { formatDateTime } from '@/lib/format';
import { useIncomingMessages } from '@/api/queries/system';
import { useMailboxes } from '@/api/queries/mailboxes';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const CLASS_LABEL: Record<IncomingClass, { label: string; className: string }> = {
  bounce: { label: 'bounce', className: 'bg-destructive/15 text-destructive' },
  auto_reply: { label: 'auto-reply', className: 'bg-info/15 text-info' },
  human_reply: { label: 'human', className: 'bg-success/15 text-success' },
  unrelated: { label: 'unrelated', className: 'bg-muted text-muted-foreground' },
};

/** F8.1 — reply-detection debug (docs/12 §11): the 4-bucket classifier made
 *  inspectable, straight off /incoming-messages. */
export function ReplyDetectionTable() {
  const [classification, setClassification] = useState<IncomingClass | undefined>(undefined);
  const [mailboxId, setMailboxId] = useState<string>('all');
  const [page, setPage] = useState(1);
  const mailboxes = useMailboxes();
  const { data, isPending, isError, refetch } = useIncomingMessages({
    per_page: 100,
    page,
    classification,
    mailbox_id: mailboxId === 'all' ? undefined : Number(mailboxId),
  });

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Reply detection</h2>
        <p className="text-xs text-muted-foreground">
          Every message the IMAP poller processed and how it classified it — the walkthrough&apos;s
          &ldquo;how the poller decides&rdquo; made inspectable.
        </p>
      </div>

      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Reply detection filters"
      >
        <Select
          value={mailboxId}
          onValueChange={(value) => {
            setMailboxId(value);
            setPage(1);
          }}
        >
          <SelectTrigger size="sm" className="w-60" aria-label="Filter by mailbox">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All mailboxes</SelectItem>
            {(mailboxes.data?.items ?? []).map((mailbox) => (
              <SelectItem key={mailbox.id} value={String(mailbox.id)}>
                {mailbox.from_address}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={classification === undefined ? 'default' : 'outline'}
          size="xs"
          onClick={() => {
            setClassification(undefined);
            setPage(1);
          }}
        >
          All
        </Button>
        {INCOMING_CLASSES.map((value) => (
          <Button
            key={value}
            variant={classification === value ? 'default' : 'outline'}
            size="xs"
            aria-pressed={classification === value}
            onClick={() => {
              setClassification(classification === value ? undefined : value);
              setPage(1);
            }}
          >
            {CLASS_LABEL[value].label}
          </Button>
        ))}
      </div>

      {isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : isError ? (
        <EmptyState
          title="Failed to load incoming messages"
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      ) : data.items.length === 0 ? (
        <EmptyState title="No messages match this filter." />
      ) : (
        <DataTable
          rows={data.items}
          rowKey={(row) => row.id}
          rowTestId={(row) => `incoming-row-${row.id}`}
          pagination={{
            page: data.page,
            perPage: data.per_page,
            total: data.total,
            onPageChange: setPage,
          }}
          columns={[
            {
              key: 'processed',
              header: 'Processed',
              cell: (row) => (
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(row.processed_at)}
                </span>
              ),
            },
            { key: 'mailbox', header: 'Mailbox', cell: (row) => `#${row.mailbox_id}` },
            { key: 'from', header: 'From', cell: (row) => row.from_address ?? '—' },
            {
              key: 'subject',
              header: 'Subject',
              className: 'max-w-64 truncate',
              cell: (row) => row.subject ?? '—',
            },
            {
              key: 'class',
              header: 'Class',
              cell: (row) => {
                const chip = CLASS_LABEL[row.classification];
                return (
                  <Badge variant="outline" className={`border-transparent ${chip.className}`}>
                    {chip.label}
                  </Badge>
                );
              },
            },
            { key: 'dsn', header: 'DSN', cell: (row) => row.dsn_status ?? '—' },
            {
              key: 'enrollment',
              header: 'Enrollment',
              cell: (row) =>
                row.matched_enrollment_id === null ? (
                  <span className="text-muted-foreground">unmatched</span>
                ) : (
                  `#${row.matched_enrollment_id}`
                ),
            },
            {
              key: 'lead',
              header: 'Lead',
              cell: (row) =>
                row.matched_lead_id === null ? (
                  <span className="text-muted-foreground">unmatched</span>
                ) : (
                  <Link
                    to={`/leads/${row.matched_lead_id}`}
                    className="underline underline-offset-2"
                  >
                    #{row.matched_lead_id}
                  </Link>
                ),
            },
            {
              key: 'events',
              header: 'Events',
              align: 'right',
              cell: (row) =>
                row.resulting_event_ids.length === 0 ? '—' : row.resulting_event_ids.join(', '),
            },
          ]}
          mobileCard={(row) => {
            const chip = CLASS_LABEL[row.classification];
            return (
              <article className="space-y-2 rounded-lg border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.subject ?? '(no subject)'}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.from_address ?? 'Unknown sender'} · mailbox #{row.mailbox_id}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={`shrink-0 border-transparent ${chip.className}`}
                  >
                    {chip.label}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(row.processed_at)} · enrollment{' '}
                  {row.matched_enrollment_id ?? 'unmatched'} · {row.resulting_event_ids.length}{' '}
                  event(s)
                </p>
                {row.dsn_status && (
                  <p className="text-xs text-muted-foreground">DSN {row.dsn_status}</p>
                )}
              </article>
            );
          }}
        />
      )}
    </section>
  );
}
