import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { MailboxDto } from '@coldemail/shared';
import { MailboxDialog } from './mailbox-dialog';
import MailboxesPage from './page';

function client() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['settings'], { default_timezone: 'Asia/Kolkata' });
  return qc;
}

function oauthMailbox(id: number, connected: boolean): MailboxDto {
  return {
    id,
    display_name: `Sender ${id}`,
    from_address: `sender${id}@sambhavpmtech.com`,
    smtp_host: 'smtp.gmail.com',
    smtp_port: 587,
    imap_host: 'imap.gmail.com',
    imap_port: 993,
    auth_type: 'google_oauth',
    oauth_connected: connected,
    daily_cap: 5,
    effective_cap: 5,
    send_window: { days: [1, 2, 3, 4, 5], start: '10:00', end: '18:00' },
    timezone: 'Asia/Kolkata',
    poll_folders: ['INBOX', '[Gmail]/Spam'],
    status: connected ? 'ok' : 'setup_required',
    status_reason: connected ? null : 'Connect Google to finish setup',
    sent_today: 0,
    hard_bounce_pct: 0,
    seven_day_avg: 0,
    last_successful_poll_at: null,
  };
}

describe('Google OAuth mailbox UI', () => {
  it('defaults to a randomized range and warns when its minimum cannot fit the window', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const mailbox = { ...oauthMailbox(1, true), daily_cap: 25, send_interval_minutes: 4 };
    render(
      <QueryClientProvider client={client()}>
        <MailboxDialog open mailbox={mailbox} onOpenChange={() => {}} />
      </QueryClientProvider>,
    );
    const interval = screen.getByLabelText('Minimum minutes');
    expect(interval).toHaveValue(4);
    expect(screen.getByLabelText('Maximum minutes')).toHaveValue(7);
    expect(screen.getByText(/25 emails have 96–168 minutes/)).toBeInTheDocument();
    await user.clear(interval);
    await user.type(interval, '30');
    expect(screen.getByText(/cannot fit the daily cap/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Maximum must be greater than minimum')).toBeInTheDocument();
  });
  it('defaults new Workspace mailboxes to OAuth and retains app password as fallback', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <QueryClientProvider client={client()}>
        <MailboxDialog open onOpenChange={() => {}} />
      </QueryClientProvider>,
    );
    const auth = screen.getByLabelText('Authentication');
    expect(auth).toHaveValue('google_oauth');
    expect(screen.queryByLabelText('App password')).not.toBeInTheDocument();
    await user.selectOptions(auth, 'app_password');
    expect(screen.getByLabelText('App password')).toBeInTheDocument();
  });

  it('shows connect and disconnect actions from each OAuth state', () => {
    const qc = client();
    qc.setQueryData(['mailboxes'], {
      items: [oauthMailbox(1, false), oauthMailbox(2, true)],
    });
    qc.setQueryData(['mailboxes', 'volume', 30], { items: [], imbalance: false });
    render(
      <QueryClientProvider client={qc}>
        <MailboxesPage />
      </QueryClientProvider>,
    );
    expect(screen.getAllByRole('button', { name: 'Connect Google' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Disconnect' })).toHaveLength(2);
    expect(screen.getAllByText('setup required')).toHaveLength(2);
  });
});
