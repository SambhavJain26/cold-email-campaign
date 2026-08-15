// CAN-SPAM footer (docs/08 §4): appended at render time AFTER all expansion,
// unconditional — template text cannot alter or remove it. NOT stored in
// step_variants.body_template. Subjects never get the footer.
//
// BOTH representations live in this file on purpose (finding 19): the plain
// text and the HTML alternative must stay semantically identical, and keeping
// them adjacent is what stops one from being changed without the other.
//
// Shape:  {opt-out clause} | {physical address}
//   dormant (no unsubscribe URL):  "{optout_text} | 12 Example St"
//   live:  text  "Unsubscribe: https://…/u/tok or reply STOP | 12 Example St"
//          html  "<a href=…>Unsubscribe</a> or reply STOP | 12 Example St"
//
// "or reply STOP" is retained even when the link exists: some clients strip
// links, and a reply is the lowest-friction opt-out there is. De-emphasised but
// legible is the CAN-SPAM "clear and conspicuous" line — hidden would not be.
import { escapeHtml } from './html';

export const FOOTER_SEPARATOR = '\n\n---\n';

export interface ComplianceInfo {
  physicalAddress: string;
  optoutText: string;
  /**
   * Fully-formed public unsubscribe URL for THIS send. Absent/empty = the
   * feature is dormant (no `unsubscribe_base_url` configured), and the footer
   * falls back to the operator's configured `optoutText`.
   */
  unsubscribeUrl?: string;
}

const liveUrl = (c: ComplianceInfo): string | undefined => {
  const url = c.unsubscribeUrl?.trim();
  return url === undefined || url === '' ? undefined : url;
};

export function appendFooter(body: string, compliance: ComplianceInfo): string {
  const url = liveUrl(compliance);
  const optout = url ? `Unsubscribe: ${url} or reply STOP` : compliance.optoutText;
  return `${body}${FOOTER_SEPARATOR}${optout} | ${compliance.physicalAddress}`;
}

/** The HTML twin of appendFooter's trailing line — same words, linked. */
export function footerHtml(compliance: ComplianceInfo): string {
  const url = liveUrl(compliance);
  const optout = url
    ? `<a href="${escapeHtml(url)}">Unsubscribe</a> or reply STOP`
    : escapeHtml(compliance.optoutText);
  return `${optout} | ${escapeHtml(compliance.physicalAddress)}`;
}
