import type { MailboxStatus } from '@coldemail/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** docs/12 §4: 🟢 ok / ⏸ paused / 🟠 auto_paused / 🔴 auth_failed / ⚠️ imap_stale / 🚫 provider_blocked */
const CHIP: Record<MailboxStatus, { glyph: string; label: string; className: string }> = {
  ok: { glyph: '🟢', label: 'ok', className: 'bg-success/15 text-success' },
  paused: { glyph: '⏸', label: 'paused', className: 'bg-muted text-muted-foreground' },
  auto_paused: { glyph: '🟠', label: 'auto-paused', className: 'bg-warning/15 text-warning' },
  auth_failed: {
    glyph: '🔴',
    label: 'auth failed',
    className: 'bg-destructive/15 text-destructive',
  },
  imap_stale: { glyph: '⚠️', label: 'imap stale', className: 'bg-warning/15 text-warning' },
  provider_blocked: {
    glyph: '🚫',
    label: 'provider blocked',
    className: 'bg-destructive/15 text-destructive',
  },
};

export function MailboxStatusChip({ status }: { status: MailboxStatus }) {
  const chip = CHIP[status];
  return (
    <Badge variant="outline" className={cn('gap-1 border-transparent text-[11px]', chip.className)}>
      <span aria-hidden>{chip.glyph}</span>
      {chip.label}
    </Badge>
  );
}
