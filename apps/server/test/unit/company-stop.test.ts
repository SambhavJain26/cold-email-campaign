import { describe, expect, it } from 'vitest';
import { senderIdentity } from '../../src/poller/companyStop';

describe('company identity', () => {
  it('joins subdomains using the public suffix boundary', () => {
    expect(senderIdentity('A@support.company.co.uk')).toEqual({
      address: 'a@support.company.co.uk',
      company: 'company.co.uk',
    });
    expect(senderIdentity('b@company.co.uk').company).toBe('company.co.uk');
  });
  it('preserves private hosted tenant boundaries', () => {
    expect(senderIdentity('a@one.github.io').company).toBe('one.github.io');
    expect(senderIdentity('b@two.github.io').company).toBe('two.github.io');
  });
  it.each([
    'gmail.com',
    'googlemail.com',
    'yahoo.com',
    'yahoo.co.in',
    'yahoo.co.uk',
    'outlook.com',
    'hotmail.co.uk',
    'live.com',
    'aol.com',
    'icloud.com',
    'proton.me',
    'protonmail.com',
    'gmx.de',
    'mail.ru',
    'qq.com',
    'yandex.ru',
  ])('keeps %s limited to exact or thread matching', (domain) => {
    expect(senderIdentity(`a@${domain}`).company).toBeNull();
  });
  it.each([
    'a@localhost',
    'a@unknown.notarealtld',
    'a@',
    'broken',
    'a@192.168.1.1',
    'a@broken..company.com',
    'a@-bad.company.com',
    'bad name@company.com',
  ])('falls back safely for %s', (address) => {
    expect(senderIdentity(address).company).toBeNull();
  });
});
