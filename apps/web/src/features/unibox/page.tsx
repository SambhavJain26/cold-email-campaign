import { useRef, useState } from 'react';
import { toast } from 'sonner';
import type { IncomingReviewRow } from '@coldemail/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CollectionPagination } from '@/components/shared/collection-pagination';
import { useCampaigns } from '@/api/queries/campaigns';
import { useMailboxes } from '@/api/queries/mailboxes';
import { useIncomingRows, useIncomingRetention } from '@/api/queries/incoming-review';
import { useIncomingMutation } from '@/api/mutations/incoming-review';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import { ReviewReader, sendingLabel } from './review-reader';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

type View = 'needs_review' | 'all' | 'acknowledged';
const VIEWS: [View, string][] = [
  ['needs_review', 'Needs review'],
  ['all', 'All'],
  ['acknowledged', 'Acknowledged'],
];
export default function UniboxPage() {
  const [view, setView] = useState<View>('needs_review');
  const [campaign, setCampaign] = useState('all');
  const [search, setSearch] = useState('');
  const [mailbox, setMailbox] = useState('all');
  const [state, setState] = useState('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<IncomingReviewRow | null>(null);
  const [retentionOpen, setRetentionOpen] = useState(false);
  const campaigns = useCampaigns();
  const mailboxes = useMailboxes();
  const acknowledgeRef = useRef<(() => void) | null>(null);
  const rows = useIncomingRows({
    view: view === 'acknowledged' ? 'acknowledged' : view === 'all' ? 'all' : 'needs_review',
    campaign_id: campaign === 'all' ? undefined : Number(campaign),
    search: search || undefined,
    mailbox_id: mailbox === 'all' ? undefined : Number(mailbox),
    sending_state: state === 'all' ? undefined : state,
    page,
    per_page: 25,
  });
  const active = selected
    ? (rows.data?.items.find(
        (r) => r.lead_id === selected.lead_id && r.campaign_id === selected.campaign_id,
      ) ?? selected)
    : null;
  const selectedCampaign = active && campaigns.data?.items.find((c) => c.id === active.campaign_id);
  const currentRow =
    active && selectedCampaign ? { ...active, campaign_status: selectedCampaign.status } : active;
  const changeView = (next: View) => {
    setView(next);
    setPage(1);
    setSelected(null);
  };
  const busy = rows.isPending;
  const error = rows.error;
  const readerOpen = !!currentRow;
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-3 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Unibox</h1>
          <p className="text-sm text-muted-foreground">
            Incoming responses await your decision. Clear opt-outs remain protected automatically.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setRetentionOpen(true)}>
          Content retention
        </Button>
      </header>
      <div className={cn('space-y-3', readerOpen && 'hidden lg:block')}>
        <div className="flex flex-wrap gap-2">
          <Select
            value={campaign}
            onValueChange={(value) => {
              setCampaign(value);
              setPage(1);
              setSelected(null);
            }}
          >
            <SelectTrigger aria-label="Unibox campaign" className="w-full sm:w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All campaigns</SelectItem>
              {campaigns.data?.items.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            aria-label="Search leads"
            placeholder="Search lead name, email or company"
            className="w-full min-w-0 flex-1 sm:min-w-64"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
          <Select
            value={mailbox}
            onValueChange={(value) => {
              setMailbox(value);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Unibox mailbox" className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All mailboxes</SelectItem>
              {mailboxes.data?.items.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={state}
            onValueChange={(value) => {
              setState(value);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Sending state" className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sending states</SelectItem>
              {(
                [
                  'held',
                  'running',
                  'delayed',
                  'stopped',
                  'suppressed',
                  'completed',
                  'bounced',
                  'not_enrolled',
                ] as const
              ).map((s) => (
                <SelectItem key={s} value={s}>
                  {s === 'held'
                    ? 'Held for review'
                    : s === 'not_enrolled'
                      ? 'Not enrolled'
                      : s === 'completed'
                        ? 'Completed'
                        : s[0]!.toUpperCase() + s.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div
          className="flex max-w-full gap-1 overflow-x-auto pb-1"
          role="group"
          aria-label="Unibox views"
        >
          {VIEWS.map(([id, label]) => (
            <Button
              key={id}
              size="sm"
              variant={view === id ? 'secondary' : 'ghost'}
              aria-pressed={view === id}
              onClick={() => changeView(id)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card lg:grid-cols-[360px_minmax(0,1fr)]">
        <section
          aria-label="Lead review list"
          className={cn(
            'min-h-0 overflow-y-auto lg:border-r lg:border-border',
            readerOpen && 'hidden lg:block',
          )}
        >
          {busy && (
            <p role="status" className="p-5 text-sm text-muted-foreground">
              Loading incoming messages…
            </p>
          )}
          {error && (
            <div className="space-y-2 p-5">
              <p role="alert" className="text-sm text-destructive">
                {error.message}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void rows.refetch();
                }}
              >
                Retry
              </Button>
            </div>
          )}
          {!busy && !error && rows.data?.items.length === 0 && (
            <p className="p-5 text-sm text-muted-foreground">
              No leads in this view. Use All to find acknowledged or resolved items.
            </p>
          )}
          {rows.data?.items.map((row) => (
            <div
              key={`${row.lead_id}:${row.campaign_id}`}
              className={cn(
                'flex items-start gap-1 border-b border-border p-3 hover:bg-muted',
                active?.lead_id === row.lead_id &&
                  active.campaign_id === row.campaign_id &&
                  'bg-muted',
              )}
            >
              <button
                type="button"
                aria-label={`Open ${row.name || row.email} in ${row.campaign_name}`}
                className="min-w-0 flex-1 space-y-1 rounded-md p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  setSelected(row);
                }}
              >
                <p className="truncate text-sm font-semibold">{row.name || row.email}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.email} · {row.company || 'No company'}
                </p>
                <p className="truncate text-xs text-muted-foreground">{row.campaign_name}</p>
                <p className="break-words text-sm">{sendingLabel(row)}</p>
                <p className="text-xs text-muted-foreground">
                  {row.message_count} message(s) · {row.unacknowledged_count} unacknowledged
                </p>
                {row.latest_received_at && (
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(row.latest_received_at)}
                  </p>
                )}
              </button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Acknowledge ${row.name || row.email} in ${row.campaign_name}`}
                disabled={row.sending_state === 'held' || row.unacknowledged_count === 0}
                onClick={() => {
                  if (active?.lead_id === row.lead_id && active.campaign_id === row.campaign_id)
                    acknowledgeRef.current?.();
                  else {
                    setSelected(row);
                    toast.info('Review the messages in the reader before acknowledging them.');
                  }
                }}
              >
                ✓
              </Button>
            </div>
          ))}
          <div className="p-3">
            <CollectionPagination
              page={page}
              perPage={25}
              total={rows.data?.total ?? 0}
              onPageChange={setPage}
            />
          </div>
        </section>
        {currentRow ? (
          <ReviewReader
            key={`${currentRow.lead_id}:${currentRow.campaign_id}`}
            row={currentRow}
            onBack={() => setSelected(null)}
            acknowledgeRef={acknowledgeRef}
          />
        ) : (
          <p className="hidden p-8 text-sm text-muted-foreground lg:block">
            Select a lead to read every incoming message, review sent context and choose an outreach
            action.
          </p>
        )}
      </div>
      <RetentionDialog open={retentionOpen} onClose={() => setRetentionOpen(false)} />
    </div>
  );
}

function RetentionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useIncomingRetention();
  const mutation = useIncomingMutation();
  const [days, setDays] = useState<string | null>(null);
  const [disabled, setDisabled] = useState<boolean | null>(null);
  const isDisabled = disabled ?? settings.data?.days === null;
  const value = days ?? String(settings.data?.days ?? 30);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Incoming content retention</DialogTitle>
          <DialogDescription>
            Delete eligible incoming content after acknowledgement in every associated queue.
            Unresolved linking and relevant review holds prevent automatic cleanup. Existing backups
            may keep content until they expire; deletion manifests protect restores.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="retention-days">Days after eligible acknowledgement</Label>
          <Input
            id="retention-days"
            type="number"
            min={1}
            max={3650}
            value={value}
            disabled={isDisabled}
            onChange={(event) => setDays(event.target.value)}
          />
        </div>
        <Button variant="outline" onClick={() => setDisabled(!isDisabled)}>
          {isDisabled ? 'Enable automatic cleanup' : 'Disable automatic cleanup'}
        </Button>
        {mutation.error && <p role="alert">{mutation.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              mutation.isPending ||
              (!isDisabled &&
                (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 3650))
            }
            onClick={() =>
              mutation.mutate(
                {
                  path: '/unibox/retention',
                  method: 'PUT',
                  result: 'retention',
                  body: { days: isDisabled ? null : Number(value) },
                },
                {
                  onSuccess: () => {
                    toast.success('Retention settings saved');
                    onClose();
                  },
                },
              )
            }
          >
            Save retention
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
