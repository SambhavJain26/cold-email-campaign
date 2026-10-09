import { expect, it } from 'vitest';
import { candidateEvidence, replySubject, specificSubject } from '../../src/poller/possibleReply';

it('normalizes repeated response prefixes without changing the specific wording', () => {
  expect(replySubject(' Auto Response: Re: Fwd: bruce: repairs into accounting ')).toBe(
    'bruce: repairs into accounting',
  );
  expect(replySubject('Out of Office Re: lori / owner onboarding handoffs')).toBe(
    'lori / owner onboarding handoffs',
  );
});
it('suggests alternate addresses using specific subjects or registrable business domains', () => {
  expect(
    candidateEvidence(
      'bja6@aol.com',
      'Auto Response: Re: bruce: repairs into accounting',
      'bruce@brucejay.com',
      'bruce: repairs into accounting',
    ),
  ).toEqual({ subject_match: true, company_match: false });
  expect(
    candidateEvidence(
      'pmaccounts@dennisrealty.com',
      'Out of Office Re: lori / owner onboarding handoffs',
      'lori@dennisrealty.com',
      'lori / owner onboarding handoffs',
    ),
  ).toEqual({ subject_match: true, company_match: true });
  expect(
    candidateEvidence(
      'accounts@support.acme.co.uk',
      'Something else',
      'owner@acme.co.uk',
      'Owner onboarding handoffs',
    ),
  ).toEqual({ subject_match: false, company_match: true });
});
it('does not match generic subjects, shared providers or wording that differs', () => {
  for (const value of [
    'Hello',
    'Thank you',
    'Out of office',
    'Re: Hello',
    'Thank you for your email',
    'Thank you very much',
    'Accounting / x',
  ])
    expect(specificSubject(replySubject(value))).toBe(false);
  for (const domain of ['gmail.com', 'yahoo.com', 'aol.com', 'outlook.com'])
    expect(candidateEvidence(`one@${domain}`, 'Hello', `two@${domain}`, 'Hello')).toEqual({
      subject_match: false,
      company_match: false,
    });
  expect(
    candidateEvidence(
      'someone@other.com',
      'Re: Different owner onboarding handoffs',
      'owner@acme.com',
      'Owner onboarding handoffs',
    ).subject_match,
  ).toBe(false);
});
