import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { LeadDto } from '@coldemail/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useCampaigns } from '@/api/queries/campaigns';
import { usePersonalizedCopies } from '@/api/queries/leads';
import { useSequences } from '@/api/queries/sequences';
import {
  useSaveCampaignPersonalizedCopy,
  useSavePersonalizedCopySource,
} from '@/api/mutations/leads';

export function PersonalizedCopyEditor({
  lead,
  open,
  onOpenChange,
}: {
  lead: LeadDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const copies = usePersonalizedCopies(lead.id, open);
  const campaigns = useCampaigns();
  const sequences = useSequences();
  const saveSource = useSavePersonalizedCopySource();
  const saveCampaign = useSaveCampaignPersonalizedCopy();
  const [scope, setScope] = useState('source:1');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [editedScope, setEditedScope] = useState<string | null>(null);

  const campaignSteps = useMemo(
    () =>
      (campaigns.data?.items ?? []).flatMap((campaign) => {
        const sequence = (sequences.data?.items ?? []).find(
          (item) => item.id === campaign.sequence_id,
        );
        return (sequence?.steps ?? [])
          .filter((step) => step.content_source === 'personalized')
          .map((step) => ({ campaign, step }));
      }),
    [campaigns.data, sequences.data],
  );

  const selected = useMemo(() => {
    if (scope.startsWith('source:')) {
      const slot = Number(scope.split(':')[1]);
      return copies.data?.sources.find((source) => source.slot_no === slot);
    }
    const [, campaignId, stepNo] = scope.split(':').map(Number);
    return copies.data?.campaign_copies.find(
      (copy) => copy.campaign_id === campaignId && copy.step_no === stepNo,
    );
  }, [copies.data, scope]);

  const currentSubject = editedScope === scope ? subject : (selected?.subject ?? '');
  const currentBody = editedScope === scope ? body : (selected?.body ?? '');

  const sent = selected && 'sent_event_id' in selected && selected.status === 'sent';
  const sentSubject = sent && 'sent_subject' in selected ? selected.sent_subject : null;
  const warnings = [
    ...(currentSubject.length > 78 ? ['Subject is longer than 78 characters.'] : []),
    ...(currentBody.trim().length < 20 ? ['Body is unusually short.'] : []),
    ...((currentBody.match(/https?:\/\//g)?.length ?? 0) > 1
      ? ['Body contains multiple links.']
      : []),
  ];

  const save = (action: 'save_draft' | 'mark_ready' | 'copy_from_source') => {
    const targetScope = scope;
    if (scope.startsWith('source:')) {
      saveSource.mutate(
        {
          leadId: lead.id,
          slotNo: Number(scope.split(':')[1]),
          body: { subject: currentSubject, body: currentBody, action, replace: true },
        },
        {
          onSuccess: () => {
            setScope(targetScope);
            setEditedScope(null);
            toast.success(action === 'mark_ready' ? 'Source marked ready' : 'Source saved');
          },
        },
      );
      return;
    }
    const [, campaignId, stepNo] = scope.split(':').map(Number);
    saveCampaign.mutate(
      {
        leadId: lead.id,
        campaignId: campaignId!,
        stepNo: stepNo!,
        body:
          action === 'copy_from_source'
            ? { action, source_slot_no: 1, replace: true }
            : { subject: currentSubject, body: currentBody, action, replace: true },
      },
      {
        onSuccess: () => {
          // A copy mutation refetches every scope. Reassert the immutable
          // target so a list reorder cannot move the editor to another
          // campaign/step before the operator's next edit.
          setScope(targetScope);
          setEditedScope(null);
          toast.success(
            action === 'mark_ready' ? 'Campaign copy marked ready' : 'Campaign copy saved',
          );
        },
      },
    );
  };

  const scopeLabel = scope.startsWith('source:')
    ? 'Reusable lead copy'
    : (() => {
        const [, campaignId, stepNo] = scope.split(':').map(Number);
        const campaign = campaignSteps.find(
          (item) => item.campaign.id === campaignId && item.step.step_no === stepNo,
        )?.campaign;
        return `${campaign?.name ?? `Campaign ${campaignId}`} · Step ${stepNo}`;
      })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Personalized Copy</DialogTitle>
          <DialogDescription>
            Reusable lead copy is stored once; campaign copy is the independent version a specific
            Personalized Copy step will send. Nothing sends from this editor.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>Copy scope</FieldLabel>
            <Select
              value={scope}
              onValueChange={(value) => {
                setScope(value);
                setEditedScope(null);
              }}
            >
              <SelectTrigger aria-label="Copy scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="source:1">
                  Reusable lead copy · not assigned to a campaign
                </SelectItem>
                {campaignSteps.map(({ campaign, step }) => (
                  <SelectItem
                    key={`${campaign.id}:${step.id}`}
                    value={`campaign:${campaign.id}:${step.step_no}`}
                  >
                    {campaign.name} · Personalized Step {step.step_no}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{selected?.status ?? 'missing'}</Badge>
            {selected?.source_import_id && (
              <Badge variant="secondary">Import #{selected.source_import_id}</Badge>
            )}
            {sent && <Badge>Sent · read only</Badge>}
          </div>
          <Field>
            <FieldLabel htmlFor="personalized-subject">Subject</FieldLabel>
            <Input
              id="personalized-subject"
              value={currentSubject}
              disabled={Boolean(sent)}
              onChange={(event) => {
                setEditedScope(scope);
                setSubject(event.target.value);
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="personalized-body">Body</FieldLabel>
            <Textarea
              id="personalized-body"
              rows={12}
              value={currentBody}
              disabled={Boolean(sent)}
              onChange={(event) => {
                setEditedScope(scope);
                setBody(event.target.value);
              }}
            />
          </Field>
          <div className="rounded-md border border-border p-3 text-sm">
            <p className="font-medium">Preview</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {sent ? 'Saved copy subject (audit)' : 'Subject'}
            </p>
            <p className="mt-1 whitespace-pre-wrap">{currentSubject || 'No subject'}</p>
            {sent && (
              <>
                <p className="mt-3 text-xs text-muted-foreground">Subject actually sent</p>
                <p className="mt-1 whitespace-pre-wrap">
                  {sentSubject ?? 'Not recorded for this historical send'}
                </p>
              </>
            )}
            <p className="mt-3 whitespace-pre-wrap text-muted-foreground">
              {currentBody || 'No body'}
            </p>
            {warnings.map((warning) => (
              <p key={warning} className="mt-2 text-xs text-muted-foreground">
                {warning}
              </p>
            ))}
          </div>
        </FieldGroup>
        <DialogFooter>
          {!scope.startsWith('source:') && !sent && (
            <Button variant="outline" onClick={() => save('copy_from_source')}>
              Copy reusable lead copy to {scopeLabel}
            </Button>
          )}
          <Button variant="outline" disabled={Boolean(sent)} onClick={() => save('save_draft')}>
            Save Draft · {scopeLabel}
          </Button>
          <Button
            disabled={Boolean(sent) || !currentSubject.trim() || !currentBody.trim()}
            onClick={() => save('mark_ready')}
          >
            Mark Ready · {scopeLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
