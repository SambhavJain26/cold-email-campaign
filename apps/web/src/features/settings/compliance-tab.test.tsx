// The compliance footer editor's live preview is the only place an operator
// sees what recipients actually receive, so it has to mirror render/footer.ts
// exactly — including the dormant fallback. A preview that lied here would be
// worse than no preview.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { ComplianceDto } from '@coldemail/shared';
import { ComplianceTab } from './compliance-tab';

const BASE: ComplianceDto = {
  physical_address: '106-460 Doyle Ave, Kelowna, BC V1Y 0C2',
  optout_text: 'Reply STOP to unsubscribe.',
  signature_name: 'Sambhav Jain',
  signature_role_line: 'Automation Specialist | Sambhav Builds',
  unsubscribe_base_url: '',
};

function renderTab(compliance: Partial<ComplianceDto> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ComplianceTab compliance={{ ...BASE, ...compliance }} onDirtyChange={() => {}} />
    </QueryClientProvider>,
  );
}

const preview = () => screen.getByTestId('footer-preview').textContent ?? '';

describe('unsubscribe base URL field', () => {
  it('dormant: preview shows the operator opt-out text and no link', () => {
    renderTab();
    expect(preview()).toContain('Reply STOP to unsubscribe.106-460 Doyle Ave');
    expect(preview()).not.toContain('https://');
  });

  it('live: preview switches to the link-and-address form', () => {
    renderTab({ unsubscribe_base_url: 'https://unsubscribe.example.com' });
    expect(preview()).toContain('Unsubscribe106-460 Doyle Ave');
    expect(screen.getByText('Unsubscribe')).toHaveClass('font-bold', 'no-underline');
    expect(screen.getByText('Unsubscribe')).not.toHaveClass('text-[#1155cc]', 'underline');
    expect(preview()).not.toContain('reply STOP');
    expect(preview()).not.toContain('⟨token⟩');
  });

  it('explains that blank means reply-STOP only', () => {
    renderTab();
    expect(screen.getByLabelText('Unsubscribe base URL')).toBeInTheDocument();
    expect(
      screen.getByText(/Leave blank until you have a real sending domain/),
    ).toBeInTheDocument();
  });

  it('rejects a non-HTTPS URL rather than silently shipping a broken link', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.type(screen.getByLabelText('Unsubscribe base URL'), 'http://insecure.example.com');
    await user.click(screen.getByRole('button', { name: 'Save compliance' }));

    expect(await screen.findByText(/must be empty or an https:\/\/ URL/)).toBeInTheDocument();
  });

  it('rejects a trailing slash — tokens are appended as /u/<token>', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.type(screen.getByLabelText('Unsubscribe base URL'), 'https://unsub.example.com/');
    await user.click(screen.getByRole('button', { name: 'Save compliance' }));

    expect(await screen.findByText(/must be empty or an https:\/\/ URL/)).toBeInTheDocument();
  });

  it('accepts the sender-domain host template used by multiple outreach domains', () => {
    renderTab({ unsubscribe_base_url: 'https://unsubscribe.{sender_domain}' });
    expect(screen.getByText('Unsubscribe')).toHaveClass('font-bold', 'no-underline');
  });
});
