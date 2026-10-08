import { useState } from 'react';
import { toast } from 'sonner';
import type { IncomingReviewMessage } from '@coldemail/shared';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useCampaigns } from '@/api/queries/campaigns';
import { useLinkCandidates } from '@/api/queries/incoming-review';
import { useIncomingMutation } from '@/api/mutations/incoming-review';

export function LinkMessage({
  message,
  initialCampaignId,
}: {
  message: IncomingReviewMessage;
  initialCampaignId?: number;
}) {
  const [open, setOpen] = useState(false);
  const [campaign, setCampaign] = useState<number | null>(initialCampaignId ?? null);
  const [search, setSearch] = useState(message.from_address ?? '');
  const [lead, setLead] = useState<number | null>(null);
  const [companySender, setCompanySender] = useState<string | undefined>();
  const campaigns = useCampaigns();
  const candidates = useLinkCandidates(open ? campaign : null, search, companySender);
  const mutation = useIncomingMutation();
  const selected = candidates.data?.items.find((c) => c.lead_id === lead);
  const [snapshot, setSnapshot] = useState(message);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setSnapshot(message);
          setOpen(true);
          mutation.reset();
          setLead(null);
        }}
      >
        {message.linking_status === 'linked' ? 'Review or correct association' : 'Link to a lead'}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!mutation.isPending) setOpen(value);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Link incoming message</DialogTitle>
            <DialogDescription>
              Choose the exact lead and primary campaign. Linking holds unfinished sequences for
              this address or protects a clear opt-out. It does not enroll or send. Company matches
              are suggestions for you to verify.
            </DialogDescription>
          </DialogHeader>
          <p className="break-words text-sm">
            {message.from_address} · {message.subject || '(No subject)'}
          </p>
          <Select
            value={campaign ? String(campaign) : ''}
            onValueChange={(value) => {
              setCampaign(Number(value));
              setLead(null);
            }}
          >
            <SelectTrigger aria-label="Link campaign" className="w-full">
              <SelectValue placeholder="Choose a campaign" />
            </SelectTrigger>
            <SelectContent>
              {campaigns.data?.items.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="space-y-2">
            <Label htmlFor="link-search">Find lead by name, email or company</Label>
            <Input
              id="link-search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setCompanySender(undefined);
                setLead(null);
              }}
            />
          </div>
          {message.from_address?.includes('@') && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSearch(message.from_address!.split('@')[1]!);
                setCompanySender(message.from_address!);
                setLead(null);
              }}
            >
              Show possible company matches
            </Button>
          )}
          <div
            className="max-h-56 space-y-2 overflow-y-auto"
            role="group"
            aria-label="Possible leads"
          >
            {candidates.data?.items.map((candidate) => (
              <Button
                key={candidate.lead_id}
                variant={lead === candidate.lead_id ? 'secondary' : 'outline'}
                className="h-auto min-h-12 w-full justify-start whitespace-normal text-left"
                onClick={() => setLead(candidate.lead_id)}
              >
                <span>
                  <span className="block">{candidate.name || candidate.email}</span>
                  <span className="block text-xs text-muted-foreground">
                    {candidate.email} · {candidate.company || 'Company not recorded'} ·{' '}
                    {candidate.state}
                  </span>
                </span>
              </Button>
            ))}
            {campaign && candidates.data?.items.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No leads found in this campaign’s pool or enrollments.
              </p>
            )}
          </div>
          {selected && (
            <p className="rounded-md bg-muted p-3 text-sm">
              Confirm {selected.email} in{' '}
              {campaigns.data?.items.find((c) => c.id === campaign)?.name}. Previously affected
              sequences remain held until separately reviewed.
            </p>
          )}
          {mutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error.message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={mutation.isPending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!selected || !campaign || mutation.isPending}
              onClick={() =>
                mutation.mutate(
                  {
                    path: `/unibox/messages/${snapshot.id}/link`,
                    result: 'message',
                    body: {
                      operation_id: crypto.randomUUID(),
                      expected_revision: snapshot.revision,
                      lead_id: lead,
                      campaign_id: campaign,
                    },
                  },
                  {
                    onSuccess: () => {
                      toast.success('Association confirmed. Review affected outreach holds.');
                      setOpen(false);
                    },
                  },
                )
              }
            >
              Confirm link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
