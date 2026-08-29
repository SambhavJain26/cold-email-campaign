import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CampaignDto, CampaignPoolItemDto } from '@coldemail/shared';
import { db as mockDb } from '@/mocks/db';
import { LeadPoolPanel } from './lead-pool-panel';

describe('Campaign lead pool panel', () => {
  it('shows responsive pool controls, audit totals, and automatic run history', () => {
    const base = mockDb.campaigns[0]!;
    const campaign: CampaignDto = {
      ...base,
      lead_selection_mode: 'pool',
      auto_enroll_enabled: true,
      pool_summary: {
        total: 3,
        available: 2,
        enrolled: 1,
        released: 0,
        temporarily_ineligible: 1,
        source_imports: 1,
      },
    };
    const poolItem: CampaignPoolItemDto = {
      id: 1,
      campaign_id: campaign.id,
      lead: {
        id: 41,
        email: 'pooled@example.dev',
        first_name: 'Pooled',
        last_name: 'Lead',
        company: 'Pool Co',
        tier: 'A',
      },
      source_import_id: 9,
      allocation_order: 1,
      status: 'available',
      enrollment_id: null,
      last_eligibility_reason: null,
      allocated_at: '2026-08-30T00:00:00.000Z',
      enrolled_at: null,
      released_at: null,
    };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
    });
    client.setQueryData(['campaigns'], { items: [campaign], total: 1, page: 1, per_page: 50 });
    client.setQueryData(['campaigns', campaign.id, 'pool', 1, undefined], {
      items: [poolItem],
      total: 1,
      page: 1,
      per_page: 50,
      summary: campaign.pool_summary,
    });
    client.setQueryData(['campaigns', campaign.id, 'auto-enrollment-runs', 1], {
      items: [
        {
          id: 7,
          trigger: 'daily',
          local_date: '2026-08-30',
          status: 'completed',
          enrolled: 1,
          started_at: '2026-08-30T00:00:05.000Z',
          completed_at: '2026-08-30T00:00:06.000Z',
          error: null,
        },
      ],
      total: 1,
      page: 1,
      per_page: 20,
    });

    render(
      <QueryClientProvider client={client}>
        <LeadPoolPanel campaign={campaign} />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Campaign lead pool')).toBeInTheDocument();
    expect(screen.getByText('Source imports')).toBeInTheDocument();
    expect(screen.getByText(/Next daily run:/)).toBeInTheDocument();
    expect(screen.getByText('Automatic enrollment history')).toBeInTheDocument();
    expect(screen.getAllByText('pooled@example.dev').length).toBeGreaterThan(0);
    expect(screen.getByRole('switch', { name: 'Automatic daily enrollment' })).toBeChecked();
  });
});
