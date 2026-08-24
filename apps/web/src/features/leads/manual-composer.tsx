import { useState } from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { LeadDto, RenderChecks } from '@coldemail/shared';
import { Button } from '@/components/ui/button';
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { TierBadge } from '@/components/shared/tier-badge';
import { AppApiError } from '@/api/client';
import { useMailboxes } from '@/api/queries/mailboxes';
import { useManualComposePrefill } from '@/api/queries/unibox';
import { useManualSend } from '@/api/mutations/unibox';

const AUTO_ROTATE = '__auto__';

type ComposerLead = LeadDto & {
  notes?: string | null;
  manual_sendable_enrollments?: Array<{
    enrollment_id: number;
    campaign_id: number;
    campaign_name: string;
  }>;
};

/** Mode-1 composer. The server owns due-step resolution and the starting copy. */
export function ManualComposer({
  lead,
  open,
  onOpenChange,
}: {
  lead: ComposerLead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const items = lead.manual_sendable_enrollments ?? [];
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<number | undefined>(undefined);
  const enrollment =
    items.find((entry) => entry.enrollment_id === selectedEnrollmentId) ?? items[0];
  const prefill = useManualComposePrefill(open ? enrollment?.enrollment_id : undefined);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Write manually to {lead.first_name ?? lead.email}</DialogTitle>
          <DialogDescription>
            Mode 1 — your words, sent through the campaign&apos;s rotation and logged as a normal
            send so metrics and threading stay intact.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{lead.company ?? lead.email}</span>
            <TierBadge tier={lead.tier} />
            {lead.custom_fields.custom_observation && (
              <span className="text-muted-foreground">
                · {lead.custom_fields.custom_observation}
              </span>
            )}
          </div>
          {lead.notes && <p className="mt-1 text-muted-foreground">Notes: {lead.notes}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="composer-campaign" className="text-xs">
            Campaign
          </Label>
          <Select
            value={enrollment ? String(enrollment.enrollment_id) : ''}
            onValueChange={(value) => setSelectedEnrollmentId(Number(value))}
          >
            <SelectTrigger id="composer-campaign" size="sm" className="w-full">
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {items.map((option) => (
                <SelectItem key={option.enrollment_id} value={String(option.enrollment_id)}>
                  {option.campaign_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {items.length === 0 && (
            <p className="text-xs text-warning">
              This lead has no active manual-sendable enrollment.
            </p>
          )}
        </div>

        {prefill.isFetching ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          // key = the render identity: a different campaign/variant remounts the
          // form so its useState initializers pick up the new starting point
          // (seeding state in an effect is banned by the react-hooks rules).
          <ComposerForm
            key={`${enrollment?.enrollment_id ?? 0}:${prefill.dataUpdatedAt}`}
            lead={lead}
            prefill={prefill.data}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ComposerForm({
  lead,
  prefill,
  onDone,
}: {
  lead: ComposerLead;
  prefill:
    | {
        enrollment_id: number;
        campaign: { id: number; name: string };
        step_no: number;
        step_count: number;
        due_at: string | null;
        personalization_mode: 'human_written' | 'template_researched' | 'template_auto';
        subject: string;
        body: string;
        draft_id: number | null;
        thread: {
          assigned_mailbox_id: number | null;
          previous_message_ids: string[];
          in_thread: boolean;
        };
        checks: RenderChecks;
      }
    | undefined;
  onDone: () => void;
}) {
  const mailboxes = useMailboxes();
  const send = useManualSend();
  const [mailboxId, setMailboxId] = useState<string>(AUTO_ROTATE);
  const [subject, setSubject] = useState(prefill?.subject ?? '');
  const [body, setBody] = useState(prefill?.body ?? '');
  const [checks, setChecks] = useState<RenderChecks | null>(prefill?.checks ?? null);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [allowRecontact, setAllowRecontact] = useState(false);

  const healthyMailboxes = (mailboxes.data?.items ?? []).filter(
    (mailbox) => mailbox.status === 'ok',
  );

  const submit = () => {
    if (!prefill) return;
    setBlockedReason(null);
    send.mutate(
      {
        lead_id: lead.id,
        campaign_id: prefill.campaign.id,
        enrollment_id: prefill.enrollment_id,
        ...(prefill.draft_id === null ? {} : { draft_id: prefill.draft_id }),
        ...(mailboxId === AUTO_ROTATE ? {} : { mailbox_id: Number(mailboxId) }),
        subject,
        body,
        ...(allowRecontact ? { allow_recontact: true } : {}),
      },
      {
        onSuccess: (result) => {
          setChecks(result.checks);
          toast.success('Sent and logged as a manual send');
          onDone();
        },
        onError: (error) => {
          if (!(error instanceof AppApiError)) return;
          if (error.code === 'mailbox_unhealthy') {
            setBlockedReason(
              `No mailbox can send this right now: ${error.message}. Fix or resume a mailbox on the Mailboxes screen, then retry.`,
            );
          } else if (error.status === 422) {
            const details = error.details as { checks?: RenderChecks } | undefined;
            if (details?.checks) setChecks(details.checks);
            setBlockedReason(`Fatal pre-send checks blocked this send: ${error.message}`);
          }
        },
      },
    );
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="composer-mailbox" className="text-xs">
          Mailbox
        </Label>
        <Select value={mailboxId} onValueChange={setMailboxId}>
          <SelectTrigger id="composer-mailbox" size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTO_ROTATE}>
              Auto-rotate — scheduler chooses a healthy mailbox
            </SelectItem>
            {healthyMailboxes.map((mailbox) => (
              <SelectItem key={mailbox.id} value={String(mailbox.id)}>
                {mailbox.from_address}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {prefill && (
        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
          <p className="font-medium">
            {prefill.campaign.name} · Step {prefill.step_no} of {prefill.step_count}
          </p>
          <p className="text-muted-foreground">
            {prefill.thread.in_thread
              ? `In thread with ${prefill.thread.previous_message_ids.length} earlier message(s); mailbox remains pinned.`
              : 'New thread; a healthy mailbox will be selected unless you choose one.'}
            {prefill.due_at ? ` Due ${new Date(prefill.due_at).toLocaleString()}.` : ''}
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="composer-subject" className="text-xs">
          Subject
        </Label>
        <Input
          id="composer-subject"
          className="h-8"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="composer-body" className="text-xs">
          Body
        </Label>
        <Textarea
          id="composer-body"
          rows={12}
          className="font-mono text-xs"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">
          The compliance footer is appended at send time — it is not part of this text.
        </p>
      </div>

      {checks && (
        <div className="space-y-1 text-[11px]" data-testid="composer-checks">
          <span className="text-muted-foreground tabular-nums">
            score {checks.score.toFixed(1)} / 10 · from the due-step render; the send re-runs the
            checks on your text
          </span>
          {checks.fatal.map((item) => (
            <p key={item.id} role="alert" className="flex items-center gap-1 text-destructive">
              <XCircle className="size-3" aria-hidden /> {item.message}
            </p>
          ))}
          {checks.warnings.map((item) => (
            <p key={item.id} className="flex items-center gap-1 text-warning">
              <AlertTriangle className="size-3" aria-hidden /> {item.message}
            </p>
          ))}
          {checks.fatal.length === 0 && checks.warnings.length === 0 && (
            <p className="flex items-center gap-1 text-success">
              <CheckCircle2 className="size-3" aria-hidden /> All pre-send checks pass.
            </p>
          )}
        </div>
      )}

      {blockedReason && (
        <p role="alert" className="text-xs text-destructive" data-testid="composer-blocked">
          {blockedReason}
        </p>
      )}

      <div className="flex items-start gap-2 rounded-md border border-border p-3">
        <Checkbox
          id="allow-recontact"
          checked={allowRecontact}
          onCheckedChange={(checked) => setAllowRecontact(checked === true)}
        />
        <Label htmlFor="allow-recontact" className="text-xs font-normal leading-5">
          I reviewed this lead&apos;s prior replies and intentionally approve recontact. This never
          overrides suppression or a future “not now” date.
        </Label>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={send.isPending || subject.trim() === '' || body.trim() === '' || !prefill}
          onClick={submit}
        >
          {send.isPending ? 'Sending…' : 'Send & log as manual'}
        </Button>
      </DialogFooter>
    </div>
  );
}
