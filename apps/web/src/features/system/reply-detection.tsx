import { useState } from 'react';
import { Link } from 'react-router-dom';
import { INCOMING_CLASSES, type IncomingClass } from '@coldemail/shared';
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
  const mailboxes = useMailboxes();
  const { data, isPending, isError, refetch } = useIncomingMessages({
    per_page: 100,
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
        <Select value={mailboxId} onValueChange={setMailboxId}>
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
          onClick={() => setClassification(undefined)}
        >
          All
        </Button>
        {INCOMING_CLASSES.map((value) => (
          <Button
            key={value}
            variant={classification === value ? 'default' : 'outline'}
            size="xs"
            aria-pressed={classification === value}
            onClick={() => setClassification(classification === value ? undefined : value)}
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
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Processed</TableHead>
                <TableHead className="text-xs">Mailbox</TableHead>
                <TableHead className="text-xs">From</TableHead>
                <TableHead className="text-xs">Subject</TableHead>
                <TableHead className="text-xs">Class</TableHead>
                <TableHead className="text-xs">DSN</TableHead>
                <TableHead className="text-xs">Enrollment</TableHead>
                <TableHead className="text-xs">Lead</TableHead>
                <TableHead className="text-right text-xs">Events</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((row) => {
                const chip = CLASS_LABEL[row.classification];
                return (
                  <TableRow key={row.id} data-testid={`incoming-row-${row.id}`}>
                    <TableCell className="py-1.5 text-xs text-muted-foreground">
                      {formatDateTime(row.processed_at)}
                    </TableCell>
                    <TableCell className="py-1.5 text-xs tabular-nums">{row.mailbox_id}</TableCell>
                    <TableCell className="py-1.5 text-xs">{row.from_address ?? '—'}</TableCell>
                    <TableCell className="max-w-64 truncate py-1.5 text-xs">
                      {row.subject ?? '—'}
                    </TableCell>
                    <TableCell className="py-1.5">
                      <Badge variant="outline" className={`border-transparent ${chip.className}`}>
                        {chip.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-1.5 text-xs tabular-nums">
                      {row.dsn_status ?? '—'}
                    </TableCell>
                    <TableCell className="py-1.5 text-xs">
                      {row.matched_enrollment_id === null ? (
                        <span className="text-muted-foreground">unmatched</span>
                      ) : (
                        `#${row.matched_enrollment_id}`
                      )}
                    </TableCell>
                    <TableCell className="py-1.5 text-xs">
                      {row.matched_lead_id === null ? (
                        <span className="text-muted-foreground">unmatched</span>
                      ) : (
                        <Link
                          to={`/leads/${row.matched_lead_id}`}
                          className="underline underline-offset-2"
                        >
                          #{row.matched_lead_id}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell className="py-1.5 text-right text-xs tabular-nums">
                      {row.resulting_event_ids.length === 0
                        ? '—'
                        : row.resulting_event_ids.join(', ')}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
