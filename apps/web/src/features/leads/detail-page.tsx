import { useState } from 'react';
import { ArrowLeft, PenLine, Plus, Trash2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { CurrentLeadTier, LeadDto } from '@coldemail/shared';
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
import { useEraseLead, usePatchLead } from '@/api/mutations/leads';
import { PersonalizedCopyEditor } from './personalized-copy-editor';
import { Timeline } from './timeline';

const UNTIERED = '__untiered__';

/** F3.3/F3.4 — Lead detail (docs/12 §2): profile, editable tier/notes/
 *  custom_observation, event timeline, suppression banner + typed-confirm. */
export default function LeadDetailPage() {
  const { id } = useParams();
  const leadId = Number(id);
  const navigate = useNavigate();
  const { data: lead, isPending, isError, refetch } = useLead(leadId);
  const erase = useEraseLead();
  const [eraseOpen, setEraseOpen] = useState(false);

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
    <div className="max-w-3xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
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
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          <TierBadge tier={lead.tier} />
          {lead.latest_enrollment && <StateBadge state={lead.latest_enrollment.current_state} />}
          <Button size="sm" variant="destructive" onClick={() => setEraseOpen(true)}>
            Erase PII
          </Button>
        </div>
      </div>

      {lead.is_suppressed && (
        <div
          className="flex flex-col items-start justify-between gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm sm:flex-row sm:items-center"
          data-testid="suppression-banner"
        >
          <p className="text-destructive">
            🚫 Suppressed — this lead opted out and is excluded from every campaign, permanently.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">Company:</span> {lead.company ?? '—'}
            </p>
            <p>
              <span className="text-muted-foreground">Location:</span>{' '}
              {[lead.city, lead.state].filter(Boolean).join(', ') || '—'}
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

        {/* Remount when authoritative editable data changes. This prevents a
            cached detail form from submitting a tier that was changed by a
            bulk action in another view. Unchanged polling responses preserve
            in-progress edits because this key stays stable. */}
        <EditCard
          key={`${lead.id}:${lead.tier ?? 'untiered'}:${lead.outreach_status}:${lead.notes ?? ''}:${JSON.stringify(lead.custom_fields)}`}
          lead={lead}
        />
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
        open={eraseOpen}
        onOpenChange={setEraseOpen}
        title="Erase this lead's personal data"
        description="Anonymize profile, import, inbox and matching alert data. Retain the minimum email-address block to prevent future outreach, message identifiers for duplicate prevention, and immutable history, which may contain legacy excerpts. Existing backups expire under normal retention. Type the email to continue."
        expected={lead.email}
        confirmLabel="Erase PII"
        pending={erase.isPending}
        onConfirm={(typed) =>
          erase.mutate(
            { id: lead.id, confirm: typed },
            {
              onSuccess: () => {
                toast.success('Lead personal data erased');
                setEraseOpen(false);
                navigate('/leads');
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
  const [outreachStatus, setOutreachStatus] = useState(lead.outreach_status);
  const [customFields, setCustomFields] = useState(() =>
    Object.entries(lead.custom_fields)
      .filter(([key]) => key !== 'custom_observation')
      .map(([key, value], index) => ({ id: index + 1, key, value })),
  );
  const [nextFieldId, setNextFieldId] = useState(customFields.length + 1);
  const [composerOpen, setComposerOpen] = useState(false);

  const customFieldsObject = Object.fromEntries(
    customFields
      .filter((field) => field.key.trim() !== '')
      .map((field) => [field.key.trim(), field.value]),
  );
  const duplicateKeys =
    new Set(customFields.map((field) => field.key.trim()).filter(Boolean)).size !==
    customFields.filter((field) => field.key.trim() !== '').length;
  const invalidFields = customFields.some((field) => field.key.trim() === '') || duplicateKeys;
  const dirty =
    (lead.tier ?? UNTIERED) !== tier ||
    lead.outreach_status !== outreachStatus ||
    (lead.notes ?? '') !== notes ||
    (lead.custom_fields.custom_observation ?? '') !== observation ||
    JSON.stringify(customFieldsObject) !==
      JSON.stringify(
        Object.fromEntries(
          Object.entries(lead.custom_fields).filter(([key]) => key !== 'custom_observation'),
        ),
      );

  const save = () =>
    patch.mutate(
      {
        id: lead.id,
        body: {
          tier: tier === UNTIERED ? null : (tier as CurrentLeadTier),
          outreach_status: outreachStatus,
          notes: notes === '' ? null : notes,
          custom_fields: (() => {
            const fields = { ...customFieldsObject };
            if (observation === '') delete fields.custom_observation;
            else fields.custom_observation = observation;
            return fields;
          })(),
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
              <SelectItem value={UNTIERED}>— untiered</SelectItem>
              <SelectItem value="A">🟢 Tier A</SelectItem>
              <SelectItem value="B">🟡 Tier B</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Outreach status</Label>
          <Select
            value={outreachStatus}
            onValueChange={(value: 'standard' | 'nurture') => {
              setOutreachStatus(value);
              if (value === 'nurture') setTier(UNTIERED);
            }}
          >
            <SelectTrigger size="sm" aria-label="Outreach status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">Standard</SelectItem>
              <SelectItem value="nurture">Nurture (not enrollable)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label>Custom fields</Label>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => {
                setCustomFields([...customFields, { id: nextFieldId, key: '', value: '' }]);
                setNextFieldId(nextFieldId + 1);
              }}
            >
              <Plus className="size-3.5" /> Add field
            </Button>
          </div>
          {customFields.map((field) => (
            <div
              key={field.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <Input
                className="col-span-2 sm:col-span-1"
                aria-label="Custom field name"
                placeholder="field_name"
                value={field.key}
                onChange={(event) =>
                  setCustomFields(
                    customFields.map((item) =>
                      item.id === field.id ? { ...item, key: event.target.value } : item,
                    ),
                  )
                }
              />
              <Input
                aria-label={`${field.key || 'Custom field'} value`}
                placeholder="Value"
                value={field.value}
                onChange={(event) =>
                  setCustomFields(
                    customFields.map((item) =>
                      item.id === field.id ? { ...item, value: event.target.value } : item,
                    ),
                  )
                }
              />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove ${field.key || 'custom field'}`}
                onClick={() => setCustomFields(customFields.filter((item) => item.id !== field.id))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          {invalidFields && (
            <p className="text-xs text-destructive">Field names must be non-empty and unique.</p>
          )}
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
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!dirty || invalidFields || patch.isPending} onClick={save}>
            Save
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={lead.is_suppressed}
            title={lead.is_suppressed ? 'Suppressed leads can never be sent to' : ''}
            onClick={() => setComposerOpen(true)}
          >
            <PenLine className="size-4" /> Personalized Copy
          </Button>
        </div>
        <PersonalizedCopyEditor lead={lead} open={composerOpen} onOpenChange={setComposerOpen} />
      </CardContent>
    </Card>
  );
}
