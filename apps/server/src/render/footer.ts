// CAN-SPAM footer (docs/08 §4): appended at render time AFTER all expansion,
// unconditional — template text cannot alter or remove it. NOT stored in
// step_variants.body_template. Subjects never get the footer.
//
// BOTH representations live in this file on purpose (finding 19): the plain
// text and the HTML alternative must stay semantically identical, and keeping
// them adjacent is what stops one from being changed without the other.
//
// Shape: {signature name}\n{role line}\n{sender domain}, then a blank line and:
// {opt-out clause}\n{physical address}
//   dormant (no unsubscribe URL):  "{optout_text}\n12 Example St"
//   live:  text  "Unsubscribe: https://…/u/tok\n12 Example St"
//          html  "<a href=…>Unsubscribe</a><br>12 Example St"
//
// STOP detection remains active in both modes. A configured URL replaces the
// opt-out clause with the link; blank uses the saved opt-out text verbatim.
import { escapeHtml } from './html';

// One blank line separates signature and compliance text. Best, joins directly
// to the name; other body endings also use this separator before the signature.
export const FOOTER_SEPARATOR = '\n\n';

export interface ComplianceInfo {
  emailFormat?: 'plain_text' | 'minimal_html';
  physicalAddress: string;
  optoutText: string;
  signatureName?: string;
  signatureRoleLine?: string;
  senderDomain?: string;
  /**
   * Fully-formed public unsubscribe URL for THIS send. Absent/empty = the
   * feature is dormant (no `unsubscribe_base_url` configured), and the footer
   * falls back to the operator's configured `optoutText`.
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
    compliance.signatureName ?? 'Sambhav Jain',
    compliance.signatureRoleLine ?? 'Automation Specialist',
    compliance.senderDomain ?? PREVIEW_SENDER_DOMAIN,
  ];
}

export function signatureHtml(compliance: ComplianceInfo): string {
  const [name, role, domain] = signatureLines(compliance).map(escapeHtml);
  return `<strong>${name}</strong><br>${role}<br>${domain}`;
}

const liveUrl = (c: ComplianceInfo): string | undefined => {
  const url = c.unsubscribeUrl?.trim();
  return url === undefined || url === '' ? undefined : url;
};

export function appendFooter(body: string, compliance: ComplianceInfo): string {
  const url = liveUrl(compliance);
  const optout = url ? `Unsubscribe: ${url}` : compliance.optoutText;
  const content = body.trimEnd();
  const separator = content.split(/\r?\n/).at(-1)?.trim() === 'Best,' ? '\n' : FOOTER_SEPARATOR;
  return `${content}${separator}${signatureLines(compliance).join('\n')}${FOOTER_SEPARATOR}${optout}\n${compliance.physicalAddress}`;
}

/** Strip the known automatic suffix, never infer its boundary from body paragraphs. */
export function stripAutomaticFooter(body: string, compliance: ComplianceInfo): string {
  const suffix = appendFooter('', compliance).trimStart();
  return body.endsWith(suffix) ? body.slice(0, -suffix.length).trimEnd() : body;
}

/** The HTML twin of appendFooter's trailing line — same words, linked. */
export function footerHtml(compliance: ComplianceInfo): string {
  const url = liveUrl(compliance);
  const optout = url
    ? `<a href="${escapeHtml(url)}" style="color:#767676;text-decoration:none;font-weight:700">Unsubscribe</a>`
    : escapeHtml(compliance.optoutText);
  const address = escapeHtml(compliance.physicalAddress).replaceAll('\n', '<br>');
  return `${optout}<br>${address}`;
}
