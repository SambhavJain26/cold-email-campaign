import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useSystemStatus } from '@/api/queries/system';

/** Transport-mode chip (docs/15 F1.2): a loud reminder whether sends are real. */
export function TransportChip() {
  const { data } = useSystemStatus();
  if (!data) return null;
  const live = data.transport_mode === 'smtp_imap';
  return (
    <Badge
      variant="outline"
      className={cn(
        'font-mono text-[11px] uppercase',
        live
          ? 'border-transparent bg-success/15 text-success'
          : 'border-transparent bg-warning/15 text-warning',
      )}
      title={live ? 'Live SMTP/IMAP transport' : 'Mock transport - no real email leaves this box'}
    >
      {live ? 'live' : 'mock'}
    </Badge>
  );
}
