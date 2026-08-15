// The one concrete DnsResolver (docs/16 §8 item 3). Thin by design: every
// decision about what a record MEANS lives in preflight.ts, which is injected
// with this in production and with a fake in tests, so the whole report is
// verifiable without a network.
import { Resolver } from 'node:dns/promises';
import type { DnsResolver } from './preflight';

/** Preflight is operator-triggered and synchronous to a screen, so it must not hang. */
const TIMEOUT_MS = 5_000;

export function createDnsResolver(): DnsResolver {
  const resolver = new Resolver({ timeout: TIMEOUT_MS, tries: 2 });
  return {
    resolveTxt: (hostname) => resolver.resolveTxt(hostname),
    resolveMx: (hostname) => resolver.resolveMx(hostname),
  };
}
