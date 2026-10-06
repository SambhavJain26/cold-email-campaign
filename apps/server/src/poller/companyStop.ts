import { domainToASCII } from 'node:url';
import { parse } from 'tldts';
import { contactedStopTargets, threadLeadId } from '../db/repos/incomingStopsRepo';
import type { DbLike } from '../db/client';
import type { IncomingMessage } from '../transport/types';
import type { SettingsRow } from '../db/repos/settingsRepo';
import { buildEvent, type DomainEvent } from '../domain/events';
import providers from './shared-provider-domains.json';

const shared = new Set([
  ...providers.domains,
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'ymail.com',
  'rocketmail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'fastmail.com',
  'hey.com',
  'mail.com',
  'gmx.com',
  'gmx.de',
  'zoho.com',
]);

export function senderIdentity(email: string): { address: string; company: string | null } {
  const address = email.trim().toLowerCase();
  const parts = address.split('@');
  if (parts.length !== 2 || !parts[0] || /\s/.test(address) || address.length > 254)
    return { address, company: null };
  const domain = domainToASCII(parts[1]!);
  if (
    !domain ||
    !domain.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    return { address, company: null };
  const parsed = parse(domain, { allowPrivateDomains: true });
  const company = parsed.isIcann || parsed.isPrivate ? parsed.domain : null;
  const labels = domain.split('.');
  const provider = labels.some((_, index) => shared.has(labels.slice(index).join('.')));
  return { address: `${parts[0]}@${domain}`, company: provider ? null : company };
}

export async function incomingStops(
  db: DbLike,
  m: IncomingMessage,
  settings: SettingsRow,
  incomingId: number,
  now: Date,
  classified: readonly DomainEvent[],
  threadEnrollmentId?: number,
): Promise<DomainEvent[]> {
  if (
    !settings.incomingStopSince ||
    m.receivedAt < settings.incomingStopSince ||
    m.receivedAt > now
  )
    return [];
  const sender = senderIdentity(m.from);
  const thread = await threadLeadId(db, threadEnrollmentId);
  const targets = await contactedStopTargets(db, m.receivedAt);
  const stoppedByReply = new Set(
    classified
      .filter(
        (e) => e.type === 'human_reply' || e.type === 'unsubscribe' || e.type === 'hard_bounce',
      )
      .map((e) => e.enrollmentId),
  );
  return targets.flatMap((target) => {
    if (stoppedByReply.has(Number(target.id))) return [];
    const lead = senderIdentity(target.email);
    const method =
      sender.address === lead.address
        ? 'exact_address'
        : thread !== undefined && Number(target.lead_id) === thread
          ? 'thread'
          : sender.company && lead.company === sender.company
            ? 'company_domain'
            : null;
    if (!method) return [];
    return [
      buildEvent.outreachStopped({
        leadId: Number(target.lead_id),
        enrollmentId: Number(target.id),
        campaignId: Number(target.campaign_id),
        occurredAt: now,
        reason: `Incoming email from ${m.from} (${method})`,
        attributes: {
          incoming_message_id: incomingId,
          sender: m.from,
          matching_method: method,
          company_domain: sender.company,
        },
      }),
    ];
  });
}
