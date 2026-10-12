import { useState } from 'react';
import type { ScheduleProposal, SequenceDto } from '@coldemail/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { usePreviewSchedule, useApplySchedule } from '@/api/mutations/sequences';

function scheduleTime(iso: string | null, timezone: string | null) {
  return iso
    ? new Date(iso).toLocaleString(undefined, {
        timeZone: timezone ?? undefined,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'None';
}

export function ScheduleChange({
  id,
  proposal,
  disabled,
  onApplied,
}: {
  id: number;
  proposal: ScheduleProposal;
  disabled: boolean;
  onApplied: (sequence: SequenceDto) => void;
}) {
  const [open, setOpen] = useState(false);
  const [operationId, setOperationId] = useState('');
  const preview = usePreviewSchedule(id);
  const apply = useApplySchedule(id);
  const data = preview.data;
  return (
    <>
      <Button
        variant="outline"
        disabled={disabled || preview.isPending}
        onClick={() => {
          preview.mutate(proposal, {
            onSuccess: () => {
              setOperationId(crypto.randomUUID());
              setOpen(true);
            },
          });
        }}
      >
        {preview.isPending ? 'Checking pending dates…' : 'Preview pending dates'}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!apply.isPending) setOpen(value);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review follow-up schedule changes</DialogTitle>
            <DialogDescription>
              Apply updates timing and pending dates together. Campaigns remain paused. Holds,
              manual delays and retries are preserved.
            </DialogDescription>
          </DialogHeader>
          {data && (
            <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto">
              <p className="text-sm">
                Shared campaigns:{' '}
                {data.campaigns.map((c) => `${c.name} (${c.status})`).join(', ') || 'None'}
              </p>
              {data.blockers.length > 0 && (
                <Alert variant="destructive">
                  <AlertDescription>{data.blockers.join(' ')}</AlertDescription>
                </Alert>
              )}
              <p className="text-sm">
                {
                  data.rows.filter((r) => r.new_due_at && !r.error && r.new_due_at !== r.old_due_at)
                    .length
                }{' '}
                pending dates will change.
              </p>
              {data.rows.map((row) => (
                <div
                  key={row.enrollment_id}
                  className="flex flex-col gap-1 rounded-md border p-3 text-sm"
                >
                  <p>
                    {row.lead_name} · Email {row.step_no}
                    {row.held ? ' · Held for review' : ''}
                  </p>
                  <p className="break-all text-muted-foreground">
                    {row.lead_email} · Enrollment {row.enrollment_id}
                  </p>
                  {row.exclusion || row.error ? (
                    <p>{row.error ?? row.exclusion}</p>
                  ) : (
                    <>
                      <p>Previous: {scheduleTime(row.old_due_at, row.timezone)}</p>
                      <p>
                        Proposed: {scheduleTime(row.new_due_at, row.timezone)} · {row.timezone}
                      </p>
                      <p>
                        After existing delays: {scheduleTime(row.effective_due_at, row.timezone)}
                      </p>
                    </>
                  )}
                </div>
              ))}
              {apply.isError && (
                <Alert variant="destructive">
                  <AlertDescription>
                    Could not apply. Close this dialog and preview again if scheduling information
                    changed.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={apply.isPending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!data?.can_apply || apply.isPending}
              onClick={() => {
                if (!data) return;
                apply.mutate(
                  { ...proposal, fingerprint: data.fingerprint, operation_id: operationId },
                  {
                    onSuccess: (result) => {
                      onApplied(result.sequence);
                      setOpen(false);
                    },
                  },
                );
              }}
            >
              {apply.isPending ? 'Applying…' : 'Apply timing and pending dates'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
