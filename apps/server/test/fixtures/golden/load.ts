import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDomainEvent, type DomainEvent } from '../../../src/domain/events';

export const GOLDEN_JSONL = path.join(path.dirname(fileURLToPath(import.meta.url)), 'events.jsonl');

/** Load the committed golden fixture as validated DomainEvents (id = seq). */
export function loadGoldenEvents(): DomainEvent[] {
  const lines = readFileSync(GOLDEN_JSONL, 'utf8').split('\n').filter(Boolean);
  return lines.map((line) => {
    const r = JSON.parse(line) as Record<string, unknown>;
    return parseDomainEvent({
      id: r.seq,
      type: r.type,
      occurredAt: new Date(r.occurred_at as string),
      leadId: r.lead_id,
      enrollmentId: r.enrollment_id,
      campaignId: r.campaign_id,
      stepNo: r.step_no,
      mailboxId: r.mailbox_id,
      messageId: r.message_id,
      sentiment: (r.sentiment as never) ?? null,
      source: r.source,
      reason: r.reason,
      attributes: r.attributes,
    });
  });
}
