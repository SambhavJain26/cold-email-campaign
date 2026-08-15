// Domain-readiness preflight (docs/16 §8 item 3).
//
// Answers one operator question — "is this safe to launch from?" — by checking
// the things that are checkable and being explicit about the things that are
// not. It does NOT configure DNS, warm a mailbox, or establish reputation, and
// a green report is not a promise of deliverability: warming, list quality and
// consent all sit outside anything software can inspect.
//
// The resolver is injected so the whole report is unit-testable with no
// network, and so a DNS outage degrades to `unknown` rather than a false fail.

export interface DnsResolver {
  /** Node's dns/promises shape: each record is an array of string chunks. */
  resolveTxt(hostname: string): Promise<string[][]>;
  resolveMx(hostname: string): Promise<{ exchange: string; priority: number }[]>;
}

/**
 * `fail` blocks launch readiness; `warn` is a judgement call the operator owns;
 * `unknown` means we could not determine it and neither should be trusted.
 */
export type PreflightStatus = 'pass' | 'warn' | 'fail' | 'unknown';

export interface PreflightCheck {
  id: string;
  label: string;
  status: PreflightStatus;
  detail: string;
}

export interface PreflightReport {
  /** No `fail` checks. Warnings and unknowns do not block. */
  ready: boolean;
  checks: PreflightCheck[];
}

export interface PreflightInput {
  physicalAddress: string;
  unsubscribeBaseUrl: string;
  minRampDays: number;
  maxMailboxDailyCap: number;
  mailboxes: { fromAddress: string; status: string; dailyCap: number }[];
}

/**
 * Selectors are chosen by whoever publishes the key, and there is no way to
 * enumerate them over DNS — so a miss across this list means "not found with a
 * common selector", never "DKIM is missing". Reported as `unknown`, not `fail`.
 */
const DKIM_SELECTORS = ['google', 'default', 'selector1', 'selector2', 'k1', 'mail', 'dkim'];

const flat = (records: string[][]): string[] => records.map((chunks) => chunks.join(''));

const domainOf = (address: string): string => address.split('@')[1]?.toLowerCase() ?? '';

async function txtContains(
  dns: DnsResolver,
  hostname: string,
  marker: string,
): Promise<'found' | 'absent' | 'error'> {
  try {
    const records = flat(await dns.resolveTxt(hostname));
    return records.some((r) => r.toLowerCase().startsWith(marker)) ? 'found' : 'absent';
  } catch {
    // ENOTFOUND/ENODATA both land here and mean the same thing for our purpose:
    // no such record published.
    return 'error';
  }
}

async function domainChecks(dns: DnsResolver, domain: string): Promise<PreflightCheck[]> {
  const checks: PreflightCheck[] = [];

  const spf = await txtContains(dns, domain, 'v=spf1');
  checks.push({
    id: `spf:${domain}`,
    label: `SPF — ${domain}`,
    status: spf === 'found' ? 'pass' : 'fail',
    detail:
      spf === 'found'
        ? 'A v=spf1 record is published.'
        : 'No v=spf1 TXT record. Receivers cannot verify this domain is allowed to send.',
  });

  const dmarc = await txtContains(dns, `_dmarc.${domain}`, 'v=dmarc1');
  checks.push({
    id: `dmarc:${domain}`,
    label: `DMARC — ${domain}`,
    status: dmarc === 'found' ? 'pass' : 'fail',
    detail:
      dmarc === 'found'
        ? 'A v=DMARC1 record is published.'
        : 'No _dmarc TXT record. Publish at least p=none before sending.',
  });

  let dkimSelector: string | null = null;
  for (const selector of DKIM_SELECTORS) {
    if ((await txtContains(dns, `${selector}._domainkey.${domain}`, 'v=dkim1')) === 'found') {
      dkimSelector = selector;
      break;
    }
  }
  checks.push({
    id: `dkim:${domain}`,
    label: `DKIM — ${domain}`,
    status: dkimSelector ? 'pass' : 'unknown',
    detail: dkimSelector
      ? `A key is published at ${dkimSelector}._domainkey.`
      : `No key found at any common selector (${DKIM_SELECTORS.join(', ')}). ` +
        'Selectors cannot be enumerated over DNS, so verify yours by hand — this is not proof DKIM is missing.',
  });

  let mxCount: number;
  try {
    mxCount = (await dns.resolveMx(domain)).length;
  } catch {
    mxCount = 0;
  }
  checks.push({
    id: `mx:${domain}`,
    label: `Reply inbox MX — ${domain}`,
    status: mxCount > 0 ? 'pass' : 'fail',
    detail:
      mxCount > 0
        ? `${mxCount} MX record(s) published — replies can be delivered.`
        : 'No MX records. Replies to this domain would bounce, and replies are the product.',
  });

  return checks;
}

export async function runPreflight(
  input: PreflightInput,
  dns: DnsResolver,
): Promise<PreflightReport> {
  const checks: PreflightCheck[] = [];

  checks.push({
    id: 'compliance_address',
    label: 'Compliance postal address',
    status: input.physicalAddress.trim() === '' ? 'fail' : 'pass',
    detail:
      input.physicalAddress.trim() === ''
        ? 'Empty — the renderer refuses ALL sends until this is set (docs/08 §4).'
        : 'Set. It is published in every email, so confirm it is not a home address.',
  });

  checks.push({
    id: 'unsubscribe_endpoint',
    label: 'Unsubscribe endpoint',
    status: input.unsubscribeBaseUrl.trim() === '' ? 'warn' : 'pass',
    detail:
      input.unsubscribeBaseUrl.trim() === ''
        ? 'Not configured — mail carries no link and no List-Unsubscribe header, and opt-out is reply-STOP only. Legal, but weak at volume.'
        : 'Configured. Gmail one-click is only proven once a real recipient uses it.',
  });

  const boxes = input.mailboxes;
  const unhealthy = boxes.filter((m) => m.status !== 'ok');
  checks.push({
    id: 'mailbox_health',
    label: 'Mailbox health',
    status: boxes.length === 0 ? 'fail' : unhealthy.length > 0 ? 'fail' : 'pass',
    detail:
      boxes.length === 0
        ? 'No mailboxes configured.'
        : unhealthy.length > 0
          ? `${unhealthy.length} of ${boxes.length} not ok (${unhealthy.map((m) => m.status).join(', ')}).`
          : `All ${boxes.length} mailbox(es) ok.`,
  });

  const overCap = boxes.filter((m) => m.dailyCap > input.maxMailboxDailyCap);
  checks.push({
    id: 'mailbox_caps',
    label: 'Conservative daily caps',
    status: overCap.length > 0 ? 'warn' : 'pass',
    detail:
      overCap.length > 0
        ? `${overCap.length} mailbox(es) exceed the ${input.maxMailboxDailyCap}/day guardrail. Pre-existing rows are not retroactively refused.`
        : `Every mailbox is within the ${input.maxMailboxDailyCap}/day guardrail.`,
  });

  checks.push({
    id: 'staged_enrollment',
    label: 'Staged enrollment enforced',
    status: input.minRampDays > 0 ? 'pass' : 'warn',
    detail:
      input.minRampDays > 0
        ? `Campaigns must ramp over at least ${input.minRampDays} days.`
        : 'min_ramp_days is 0, so a campaign may enrol its whole list on day one. Set it before a real launch.',
  });

  // One pass per distinct sending domain, so two mailboxes on one domain do
  // not duplicate every DNS check.
  const domains = [...new Set(boxes.map((m) => domainOf(m.fromAddress)).filter((d) => d !== ''))];
  for (const domain of domains.sort()) {
    checks.push(...(await domainChecks(dns, domain)));
  }

  return { ready: !checks.some((c) => c.status === 'fail'), checks };
}
