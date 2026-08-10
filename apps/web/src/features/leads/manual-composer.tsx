import { useState } from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { CampaignDto, LeadDto, RenderChecks } from '@coldemail/shared';
import { Button } from '@/components/ui/button';
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
import { useCampaigns } from '@/api/queries/campaigns';
import { useMailboxes } from '@/api/queries/mailboxes';
import { useSequencePreview, useSequences } from '@/api/queries/sequences';
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

/** F6.4 — Mode-1 manual composer (docs/12 §14). The step-1 render is a STARTING
 *  POINT the operator deviates from — that deviation is what makes it Mode 1. */
export function ManualComposer({
  lead,
  open,
  onOpenChange,
}: {
  lead: ComposerLead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const campaigns = useCampaigns();
  const sequences = useSequences();
  const [campaignId, setCampaignId] = useState<number | undefined>(undefined);

  const eligibleIds = new Set(
    (lead.manual_sendable_enrollments ?? []).map((entry) => entry.campaign_id),
  );
  const items = (campaigns.data?.items ?? []).filter(
    (campaign) => campaign.status === 'active' && eligibleIds.has(campaign.id),
  );
  const campaign = items.find((c) => c.id === campaignId) ?? items[0];
  const sequence = sequences.data?.items.find((s) => s.id === campaign?.sequence_id);
  const variant = sequence?.steps.find((s) => s.step_no === 1)?.variants.find((v) => v.active);

  const preview = useSequencePreview(
    open ? sequence?.id : undefined,
    variant ? { lead_id: lead.id, step_no: 1, variant_id: variant.id } : undefined,
  );

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
            value={campaign ? String(campaign.id) : ''}
            onValueChange={(value) => setCampaignId(Number(value))}
          >
            <SelectTrigger id="composer-campaign" size="sm" className="w-full">
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {items.map((option) => (
                <SelectItem key={option.id} value={String(option.id)}>
                  {option.name}
                  {option.status !== 'active' && ` (${option.status})`}
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

        {preview.isFetching ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          // key = the render identity: a different campaign/variant remounts the
          // form so its useState initializers pick up the new starting point
          // (seeding state in an effect is banned by the react-hooks rules).
          <ComposerForm
            key={`${campaign?.id ?? 0}:${variant?.id ?? 0}:${preview.dataUpdatedAt}`}
            lead={lead}
            campaign={campaign}
            hasSequence={sequence !== undefined}
            initialSubject={preview.data?.subject ?? ''}
            initialBody={preview.data?.body ?? ''}
            initialChecks={preview.data?.checks ?? null}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ComposerForm({
  lead,
  campaign,
  hasSequence,
  initialSubject,
  initialBody,
  initialChecks,
  onDone,
}: {
  lead: ComposerLead;
  campaign: CampaignDto | undefined;
  hasSequence: boolean;
  initialSubject: string;
  initialBody: string;
  initialChecks: RenderChecks | null;
  onDone: () => void;
}) {
  const mailboxes = useMailboxes();
  const send = useManualSend();
  const [mailboxId, setMailboxId] = useState<string>(AUTO_ROTATE);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [checks, setChecks] = useState<RenderChecks | null>(initialChecks);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);

  const healthyMailboxes = (mailboxes.data?.items ?? []).filter(
    (mailbox) => mailbox.status === 'ok',
  );

  const submit = () => {
    if (!campaign) return;
    setBlockedReason(null);
    send.mutate(
      {
        lead_id: lead.id,
        campaign_id: campaign.id,
        ...(mailboxId === AUTO_ROTATE ? {} : { mailbox_id: Number(mailboxId) }),
        subject,
        body,
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

      {!hasSequence && (
        <p className="text-xs text-muted-foreground" data-testid="composer-no-sequence">
          This campaign has no sequence, so there is nothing to prefill — write from scratch.
        </p>
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
            score {checks.score.toFixed(1)} / 10 · from the step-1 render; the send re-runs the
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

      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={send.isPending || subject.trim() === '' || body.trim() === '' || !campaign}
          onClick={submit}
        >
          {send.isPending ? 'Sending…' : 'Send & log as manual'}
        </Button>
      </DialogFooter>
    </div>
  );
}
