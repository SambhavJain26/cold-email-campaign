import { useState } from 'react';
import { ArrowLeft, PenLine } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { LeadDto, LeadTier } from '@coldemail/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { ConfirmTypedDialog } from '@/components/shared/confirm-typed-dialog';
import { EmptyState } from '@/components/shared/empty-state';
import { StateBadge } from '@/components/shared/state-badge';
import { TierBadge } from '@/components/shared/tier-badge';
import { useLead } from '@/api/queries/leads';
import { usePatchLead, useRemoveSuppression } from '@/api/mutations/leads';
import { ManualComposer } from './manual-composer';
import { Timeline } from './timeline';

const UNTIERED = '__untiered__';

/** F3.3/F3.4 - Lead detail (docs/12 §2): profile, editable tier/notes/
 *  custom_observation, event timeline, suppression banner + typed-confirm. */
export default function LeadDetailPage() {
  const { id } = useParams();
  const leadId = Number(id);
  const { data: lead, isPending, isError, refetch } = useLead(leadId);
  const removeSuppression = useRemoveSuppression();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (isPending) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (isError || Number.isNaN(leadId)) {
    return (
      <div className="p-6">
        <EmptyState title="Lead not found" actionLabel="Retry" onAction={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-4 p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/leads" aria-label="Back to leads">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-lg font-semibold">
            {[lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email}
          </h1>
          <p className="text-sm text-muted-foreground">{lead.email}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <TierBadge tier={lead.tier} />
          {lead.latest_enrollment && <StateBadge state={lead.latest_enrollment.current_state} />}
        </div>
      </div>

      {lead.is_suppressed && (
        <div
          className="flex items-center justify-between rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm"
          data-testid="suppression-banner"
        >
          <p className="text-destructive">
            🚫 Suppressed - this lead opted out and is excluded from every campaign, permanently.
          </p>
          <button
            className="text-destructive underline-offset-2 hover:underline"
            onClick={() => setConfirmOpen(true)}
          >
            Remove suppression
          </button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">Company:</span> {lead.company ?? ' - '}
            </p>
            <p>
              <span className="text-muted-foreground">Location:</span>{' '}
              {[lead.city, lead.state].filter(Boolean).join(', ') || ' - '}
            </p>
            {lead.latest_enrollment && (
              <p>
                <span className="text-muted-foreground">Campaign:</span>{' '}
                {lead.latest_enrollment.campaign_id} · step {lead.latest_enrollment.current_step_no}
              </p>
            )}
            {Object.entries(lead.custom_fields)
              .filter(([key]) => key !== 'custom_observation')
              .map(([key, value]) => (
                <p key={key}>
                  <span className="text-muted-foreground">{key.replaceAll('_', ' ')}:</span> {value}
                </p>
              ))}
          </CardContent>
        </Card>

        {/* key remounts the edit card when the lead identity changes - state
            initializers replace the setState-in-effect seeding pattern the
            react-hooks compiler rule bans. */}
        <EditCard key={lead.id} lead={lead} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Event timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <Timeline events={lead.timeline} />
        </CardContent>
      </Card>

      <ConfirmTypedDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Remove suppression"
        description="Removing a suppression re-allows cold email to someone who opted out. Type the lead's email to confirm (decision U)."
        expected={lead.email}
        confirmLabel="Remove suppression"
        pending={removeSuppression.isPending}
        onConfirm={(typed) =>
          removeSuppression.mutate(
            { email: lead.email, confirm: typed },
            {
              onSuccess: () => {
                toast.success('Suppression removed');
                setConfirmOpen(false);
              },
            },
          )
        }
      />
    </div>
  );
}

function EditCard({ lead }: { lead: LeadDto & { notes: string | null } }) {
  const patch = usePatchLead();
  const [tier, setTier] = useState<string>(lead.tier ?? UNTIERED);
  const [notes, setNotes] = useState(lead.notes ?? '');
  const [observation, setObservation] = useState(lead.custom_fields.custom_observation ?? '');
  const [composerOpen, setComposerOpen] = useState(false);

  const dirty =
    (lead.tier ?? UNTIERED) !== tier ||
    (lead.notes ?? '') !== notes ||
    (lead.custom_fields.custom_observation ?? '') !== observation;

  const save = () =>
    patch.mutate(
      {
        id: lead.id,
        body: {
          tier: tier === UNTIERED ? null : (tier as LeadTier),
          notes: notes === '' ? null : notes,
          custom_fields: {
            ...lead.custom_fields,
            ...(observation === '' ? {} : { custom_observation: observation }),
          },
        },
      },
      { onSuccess: () => toast.success('Lead updated') },
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Edit</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label>Tier</Label>
          <Select value={tier} onValueChange={setTier}>
            <SelectTrigger size="sm" aria-label="Tier">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNTIERED}> -  untiered</SelectItem>
              <SelectItem value="A">🟢 Tier A</SelectItem>
              <SelectItem value="B">🟡 Tier B</SelectItem>
              <SelectItem value="C">⚪ Tier C</SelectItem>
              <SelectItem value="nurture">🔵 Nurture</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="lead-observation">Custom observation (researched-mode slot)</Label>
          <Input
            id="lead-observation"
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lead-notes">Notes</Label>
          <Textarea
            id="lead-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={!dirty || patch.isPending} onClick={save}>
            Save
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={lead.is_suppressed}
            title={lead.is_suppressed ? 'Suppressed leads can never be sent to' : ''}
            onClick={() => setComposerOpen(true)}
          >
            <PenLine className="size-4" /> Manual compose
          </Button>
        </div>
        <ManualComposer lead={lead} open={composerOpen} onOpenChange={setComposerOpen} />
      </CardContent>
    </Card>
  );
}
