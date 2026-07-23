// F0.6 — shared-component tests (the F0 gate's "component tests green").
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CapacityMeter } from './capacity-meter';
import { ConfirmTypedDialog } from './confirm-typed-dialog';
import { DataTable, type DataTableColumn } from './data-table';
import { EmptyState } from './empty-state';
import { MetricStat } from './metric-stat';
import { ProgressBar } from './progress-bar';
import { SentimentTag } from './sentiment-tag';
import { Sparkline } from './sparkline';
import { StateBadge } from './state-badge';
import { TierBadge } from './tier-badge';

describe('MetricStat', () => {
  it('renders the headline value and the full reconciliation in the title attr', () => {
    // The spec's own example: 72 / 867 = 8.3% (docs/11 §1).
    render(
      <MetricStat label="Reply rate" metric={{ numerator: 72, denominator: 867, value: 8.3 }} />,
    );
    expect(screen.getByText('Reply rate')).toBeInTheDocument();
    expect(screen.getByText(/8\.3/)).toBeInTheDocument();
    expect(screen.getByTitle('72 / 867 = 8.3%')).toBeInTheDocument();
  });

  it('handles a null denominator without fabricating a ratio', () => {
    render(
      <MetricStat
        label="Meetings"
        metric={{ numerator: 17, denominator: null, value: 17 }}
        unit=""
      />,
    );
    expect(screen.getByTitle('17')).toBeInTheDocument();
  });
});

describe('TierBadge', () => {
  it.each([
    ['A', '🟢', 'Tier A'],
    ['B', '🟡', 'Tier B'],
    ['C', '⚪', 'Tier C'],
    ['nurture', '🔵', 'Nurture'],
  ] as const)('renders the walkthrough glyph for %s', (tier, glyph, label) => {
    const { container } = render(<TierBadge tier={tier} />);
    expect(container).toHaveTextContent(glyph);
    expect(container).toHaveTextContent(label);
  });

  it('renders untiered for null (decision R)', () => {
    render(<TierBadge tier={null} />);
    expect(screen.getByText(/untiered/)).toBeInTheDocument();
  });
});

describe('StateBadge', () => {
  it('renders every enrollment state literally', () => {
    for (const state of [
      'NEW',
      'ACTIVE',
      'REPLIED',
      'BOUNCED',
      'UNSUBSCRIBED',
      'COMPLETED',
    ] as const) {
      const { unmount } = render(<StateBadge state={state} />);
      expect(screen.getByText(state)).toBeInTheDocument();
      unmount();
    }
  });
});

describe('SentimentTag', () => {
  it('marks a suggested tag as AI-assisted (docs/12 §13)', () => {
    render(<SentimentTag sentiment="positive" suggested />);
    expect(screen.getByText('positive')).toBeInTheDocument();
    expect(screen.getByText('(AI-assisted)')).toBeInTheDocument();
  });
});

describe('ProgressBar', () => {
  it('shows exact numbers, never a bare percentage', () => {
    render(<ProgressBar label="Contacted" value={867} max={885} />);
    expect(screen.getByText('867 / 885 (98%)')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '867');
  });

  it('survives a null max', () => {
    render(<ProgressBar label="Open-ended" value={5} max={null} />);
    expect(screen.getByText('5 (0%)')).toBeInTheDocument();
  });
});

describe('CapacityMeter', () => {
  it('renders the TODAY panel rows off the capacity DTO', () => {
    render(
      <CapacityMeter
        capacity={{
          total_daily_capacity: 120,
          followups_due_today: 34,
          sent_so_far_today: 12,
          room_for_new: 74,
          ramp_cap_remaining: 20,
          suggested: 20,
        }}
      />,
    );
    const meter = screen.getByTestId('capacity-meter');
    expect(within(meter).getByText('Follow-ups due today')).toBeInTheDocument();
    expect(within(meter).getByText('74')).toBeInTheDocument();
    expect(within(meter).getByTestId('suggested')).toHaveTextContent('20');
    expect(within(meter).getByText('12 / 120 (10%)')).toBeInTheDocument();
  });

  it('omits the ramp row once ramp is over (null)', () => {
    render(
      <CapacityMeter
        capacity={{
          total_daily_capacity: 120,
          followups_due_today: 0,
          sent_so_far_today: 0,
          room_for_new: 120,
          ramp_cap_remaining: null,
          suggested: 120,
        }}
      />,
    );
    expect(screen.queryByText('Ramp cap remaining')).not.toBeInTheDocument();
  });
});

describe('DataTable', () => {
  interface Row {
    id: number;
    email: string;
    sent: number;
  }
  const columns: Array<DataTableColumn<Row>> = [
    { key: 'email', header: 'Email', cell: (r) => r.email },
    { key: 'sent', header: 'Sent', cell: (r) => r.sent, align: 'right' },
  ];
  const rows: Row[] = [
    { id: 1, email: 'a@example.com', sent: 12 },
    { id: 2, email: 'b@example.com', sent: 9 },
  ];

  it('renders rows and right-aligns numerics', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.getByText('a@example.com')).toBeInTheDocument();
    expect(screen.getByText('12').className).toContain('text-right');
  });

  it('renders the empty state when there are no rows', () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} emptyTitle="No leads" />);
    expect(screen.getByText('No leads')).toBeInTheDocument();
  });

  it('pages with the contract envelope numbers', async () => {
    const onPageChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        pagination={{ page: 2, perPage: 50, total: 885, onPageChange }}
      />,
    );
    expect(screen.getByText('51–100 of 885')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPageChange).toHaveBeenCalledWith(3);
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('disables Previous on the first page and hides pagination when one page suffices', () => {
    const { rerender } = render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        pagination={{ page: 1, perPage: 50, total: 885, onPageChange: vi.fn() }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    rerender(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        pagination={{ page: 1, perPage: 50, total: 2, onPageChange: vi.fn() }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });
});

describe('ConfirmTypedDialog', () => {
  it('keeps Confirm disabled until the exact expected string is typed (decision U)', async () => {
    // Radix sets pointer-events:none on body while the dialog is open; jsdom
    // computes no cascade, so user-event's check false-positives — disable it.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onConfirm = vi.fn();
    render(
      <ConfirmTypedDialog
        open
        onOpenChange={() => {}}
        title="Remove suppression"
        expected="jane@acme.com"
        confirmLabel="Remove"
        onConfirm={onConfirm}
      />,
    );
    const confirm = screen.getByRole('button', { name: 'Remove' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/to confirm/), 'jane@acme');
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/to confirm/), '.com');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('jane@acme.com');
  });
});

describe('EmptyState', () => {
  it('fires the action (the retry convention, docs/11 §3)', async () => {
    const onAction = vi.fn();
    render(<EmptyState title="Failed to load" actionLabel="Retry" onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onAction).toHaveBeenCalledOnce();
  });
});

describe('Sparkline', () => {
  it('renders without axes in jsdom', () => {
    render(<Sparkline data={[1, 3, 2, 5, 4]} />);
    expect(screen.getByTestId('sparkline')).toBeInTheDocument();
  });
});
