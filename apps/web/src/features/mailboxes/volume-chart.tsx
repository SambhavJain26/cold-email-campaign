import { useMemo } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle } from 'lucide-react';
import type { MailboxDto } from '@coldemail/shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useMailboxVolume } from '@/api/queries/mailboxes';

const LINE_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
];

/** F2.4: per-mailbox 30-day send lines + the imbalance warning banner (docs/12 §4). */
export function VolumeChart({ mailboxes }: { mailboxes: MailboxDto[] }) {
  const { data } = useMailboxVolume(30);

  const { rows, mailboxIds } = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string>>();
    const ids: number[] = [];
    for (const item of data?.items ?? []) {
      ids.push(item.mailbox_id);
      for (const point of item.series) {
        const row = byDate.get(point.date) ?? { date: point.date };
        row[`m${item.mailbox_id}`] = point.sends;
        byDate.set(point.date, row);
      }
    }
    return {
      rows: [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))),
      mailboxIds: ids,
    };
  }, [data]);

  if (!data) return null;
  const label = (id: number) => mailboxes.find((m) => m.id === id)?.from_address ?? `Mailbox ${id}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">All-campaign send volume — last 30 days</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.imbalance && (
          <Alert className="border-warning/40 text-warning" data-testid="imbalance-banner">
            <AlertTriangle className="size-4" />
            <AlertTitle>Rotation imbalance</AlertTitle>
            <AlertDescription>
              One mailbox is sending well above the seven-day average of the others — check its
              pacing before providers notice the skew.
            </AlertDescription>
          </Alert>
        )}
        <div className="h-56 w-full" data-testid="volume-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                tickLine={false}
                minTickGap={32}
                tickFormatter={(value: string) => value.slice(5)}
              />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: 'var(--color-popover)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend formatter={(value: string) => label(Number(value.slice(1)))} />
              {mailboxIds.map((id, i) => (
                <Line
                  key={id}
                  dataKey={`m${id}`}
                  stroke={LINE_COLORS[i % LINE_COLORS.length]}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="min-h-11 cursor-pointer py-3 font-medium text-foreground">
            View accessible chart values
          </summary>
          <div className="max-h-48 overflow-y-auto rounded-md border border-border p-3">
            {rows.length === 0 ? (
              <p>No sends in this period.</p>
            ) : (
              <ul className="space-y-1">
                {rows.map((row) => (
                  <li key={String(row.date)}>
                    <span className="font-medium">{row.date}:</span>{' '}
                    {mailboxIds
                      .map((id) => `${label(id)} ${Number(row[`m${id}`] ?? 0)} sends`)
                      .join(' · ')}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
