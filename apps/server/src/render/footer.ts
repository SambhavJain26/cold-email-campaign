// Sender signature appended after expansion. Legacy opt-out configuration
// remains readable, but new bodies contain only the signature and address.
// Unsubscribe headers/endpoints and incoming STOP suppression remain active.
import { escapeHtml } from './html';

// One blank line separates the message from the signature; its four lines are
// adjacent, including Best, immediately followed by the name.
export const FOOTER_SEPARATOR = '\n\n';

export interface ComplianceInfo {
  emailFormat?: 'plain_text' | 'minimal_html';
  physicalAddress: string;
  optoutText: string;
  signatureName?: string;
  signatureRoleLine?: string;
  senderDomain?: string;
  /**
   * Compatibility input: used by callers for headers, never appended to new bodies.
   */
  unsubscribeUrl?: string;
}

export const PREVIEW_SENDER_DOMAIN = '[sender domain — select a preview mailbox]';

export function senderDomainOf(fromAddress: string): string {
  const at = fromAddress.lastIndexOf('@');
  const domain = fromAddress
    .slice(at + 1)
    .trim()
    .toLowerCase();
  if (at < 1 || !/^[a-z0-9.-]+\.[a-z0-9.-]+$/.test(domain)) {
    throw new Error('sender mailbox has an invalid domain');
  }
  return domain;
}

function signatureLines(compliance: ComplianceInfo): [string, string, string] {
  return [
    'Best,',
    compliance.signatureName ?? 'Sambhav Jain',
    `${compliance.signatureRoleLine ?? 'PM Systems & Automation Specialist'} | ${compliance.senderDomain ?? PREVIEW_SENDER_DOMAIN}`,
  ];
}

export function signatureHtml(compliance: ComplianceInfo): string {
  return signatureLines(compliance).map(escapeHtml).join('<br>');
}

/** A terminal sign-off belongs to the automatic signature, not the body. */
export const bodyWithoutSignoff = (body: string): string =>
  body
    .trimEnd()
    .replace(
      /(?:^|\n)[ \t]*Best,[ \t]*(?:\n[ \t]*Best,[ \t]*)*(?:\n[ \t]*[\p{L}][\p{L} .'-]{0,79})?\s*$/iu,
      '',
    )
    .trimEnd();

export function appendFooter(body: string, compliance: ComplianceInfo): string {
  const content = bodyWithoutSignoff(body);
  return `${content ? content + FOOTER_SEPARATOR : ''}${signatureLines(compliance).join('\n')}\n${compliance.physicalAddress}`;
}

/** Strip the known automatic suffix, never infer its boundary from body paragraphs. */
export function stripAutomaticFooter(body: string, compliance: ComplianceInfo): string {
  const suffix = appendFooter('', compliance).trimStart();
  return body.endsWith(suffix) ? body.slice(0, -suffix.length).trimEnd() : body;
}

/** The HTML twin of appendFooter's address line. */
export function footerHtml(compliance: ComplianceInfo): string {
  const address = escapeHtml(compliance.physicalAddress).replaceAll('\n', '<br>');
  return address;
}
