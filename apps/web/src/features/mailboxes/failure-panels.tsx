import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import type { AlertDto, MailboxDto } from '@coldemail/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/format';
import { useAlerts } from '@/api/queries/alerts';
import {
  useReconnectMailbox,
  useResumeMailbox,
  useTestConnection,
} from '@/api/mutations/mailboxes';

/** F2.3 — the Stage-7 failure panels (docs/12 §4), one card per unhealthy mailbox. */
export function FailurePanels({ mailboxes }: { mailboxes: MailboxDto[] }) {
  const failing = mailboxes.filter((m) =>
    ['auth_failed', 'imap_stale', 'auto_paused'].includes(m.status),
  );
  if (failing.length === 0) return null;
  return (
    <div className="space-y-3">
      {failing.map((mailbox) =>
        mailbox.status === 'auth_failed' ? (
          <AuthFailedPanel key={mailbox.id} mailbox={mailbox} />
        ) : mailbox.status === 'imap_stale' ? (
          <ImapStalePanel key={mailbox.id} mailbox={mailbox} />
        ) : (
          <AutoPausedPanel key={mailbox.id} mailbox={mailbox} />
        ),
      )}
    </div>
  );
}

function PanelCard({
  tone,
  title,
  children,
  testId,
}: {
  tone: 'red' | 'amber';
  title: string;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <Card
      data-testid={testId}
      className={cn(
        'gap-3 py-4',
        tone === 'red'
          ? 'border-destructive/50 bg-destructive/5'
          : 'border-warning/50 bg-warning/5',
      )}
    >
      <CardHeader className="py-0">
        <CardTitle className={cn('text-sm', tone === 'red' ? 'text-destructive' : 'text-warning')}>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">{children}</CardContent>
    </Card>
  );
}

function AuthFailedPanel({ mailbox }: { mailbox: MailboxDto }) {
  const [password, setPassword] = useState('');
  const reconnect = useReconnectMailbox();
  return (
    <PanelCard
      tone="red"
      title={`🔴 ${mailbox.from_address} — authentication failed`}
      testId={`auth-failed-${mailbox.id}`}
    >
      <p className="text-muted-foreground">
        {mailbox.status_reason ?? 'The provider rejected the stored app password.'} Its scheduled
        follow-ups remain queued for this mailbox; new sends from this address are on hold until it
        reconnects.
      </p>
      <div className="flex max-w-md gap-2">
        <Input
          type="password"
          placeholder="New app password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label={`New app password for ${mailbox.from_address}`}
        />
        <Button
          variant="destructive"
          disabled={password.length === 0 || reconnect.isPending}
          onClick={() =>
            reconnect.mutate(
              { id: mailbox.id, password },
              { onSuccess: () => toast.success(`${mailbox.from_address} reconnected`) },
            )
          }
        >
          Reconnect Mailbox
        </Button>
      </div>
    </PanelCard>
  );
}

function ImapStalePanel({ mailbox }: { mailbox: MailboxDto }) {
  const test = useTestConnection();
  const qc = useQueryClient();
  return (
    <PanelCard
      tone="amber"
      title={`⚠️ ${mailbox.from_address} — IMAP poll is stale`}
      testId={`imap-stale-${mailbox.id}`}
    >
      <p className="text-muted-foreground">
        Last successful poll{' '}
        {mailbox.last_successful_poll_at
          ? formatRelativeTime(mailbox.last_successful_poll_at)
          : 'never'}
        . Replies and bounces arriving at this inbox are not being detected — sequences that should
        stop may keep sending.
      </p>
      <Button
        variant="outline"
        disabled={test.isPending}
        onClick={() =>
          test.mutate(mailbox.id, {
            onSuccess: (result) => {
              toast[result.imap_ok ? 'success' : 'error'](
                result.imap_ok ? 'IMAP connection restored' : 'IMAP still unreachable',
              );
              void qc.invalidateQueries({ queryKey: ['mailboxes'] });
            },
          })
        }
      >
        Retry connection now
      </Button>
    </PanelCard>
  );
}

function AutoPausedPanel({ mailbox }: { mailbox: MailboxDto }) {
  const resume = useResumeMailbox();
  const { data: alerts } = useAlerts(true);
  const paired = alerts?.items.find(
    (a: AlertDto) =>
      a.kind === 'mailbox_auto_paused' &&
      (a.payload as { mailbox_id?: number }).mailbox_id === mailbox.id,
  );
  return (
    <PanelCard
      tone="amber"
      title={`🟠 ${mailbox.from_address} — auto-paused`}
      testId={`auto-paused-${mailbox.id}`}
    >
      <p className="text-muted-foreground">
        {mailbox.status_reason ?? 'Bounce threshold crossed.'} Likely cause: a bad batch of
        addresses. Re-verify the leads this mailbox contacted recently before resuming.
      </p>
      {paired && (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {Object.entries(paired.payload)
            .filter(([key]) => key !== 'mailbox_id')
            .map(([key, value]) => (
              <div key={key} className="flex gap-1">
                <dt className="font-medium">{key.replaceAll('_', ' ')}:</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
        </dl>
      )}
      <div className="flex gap-2">
        <Button variant="outline" asChild>
          <Link to="/leads">Re-verify leads</Link>
        </Button>
        <Button
          variant="outline"
          disabled={resume.isPending}
          onClick={() =>
            resume.mutate(
              { id: mailbox.id, cap_pct: 50 },
              { onSuccess: () => toast.success(`${mailbox.from_address} resumed at 50% cap`) },
            )
          }
        >
          Resume at 50%
        </Button>
      </div>
    </PanelCard>
  );
}
