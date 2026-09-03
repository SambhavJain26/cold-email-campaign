import { describe, expect, it } from 'vitest';
import { resolveCampaignSelection } from './campaign-selector';

describe('resolveCampaignSelection', () => {
  const campaigns = [{ id: 4 }, { id: 8 }];

  it('shows the first campaign when Overview uses its default data', () => {
    expect(resolveCampaignSelection(campaigns, undefined)).toBe(4);
  });

  it('preserves a valid URL selection and replaces an invalid one', () => {
    expect(resolveCampaignSelection(campaigns, 8)).toBe(8);
    expect(resolveCampaignSelection(campaigns, 99)).toBe(4);
  });
});
