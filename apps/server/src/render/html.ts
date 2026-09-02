/** Minimal, deliberately boring HTML alternative for multipart email. */
export const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/**
 * `footerHtml` is supplied by footer.ts when the footer needs markup the plain
 * text cannot carry (the unsubscribe anchor). Omitted → the footer is escaped
 * verbatim, which is the dormant case.
 */
export function htmlOfText(bodyText: string, footerHtml?: string): string {
  const paragraphs = (text: string) =>
    text
      .split('\n\n')
      .map(
        (paragraph, index, all) =>
          `<p style="margin:0 0 ${index === all.length - 1 ? '0' : '16px'}">${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`,
      )
      .join('');
  if (footerHtml === undefined) return paragraphs(bodyText);

  // appendFooter uses one final blank paragraph as the visual boundary. Split
  // from the end so every earlier paragraph remains part of the message body.
  const separator = '\n\n';
  const footerAt = bodyText.lastIndexOf(separator);
  if (footerAt === -1) return paragraphs(bodyText);
  const body = bodyText.slice(0, footerAt);
  const footer = bodyText.slice(footerAt + separator.length);
  const bodyHtml = paragraphs(body);
  const inner = footerHtml ?? escapeHtml(footer).replaceAll('\n', '<br>');
  // A one-cell presentation table is deliberately used instead of a trailing
  // signature-like paragraph. It is robust across email clients, keeps the
  // two required lines in the new message's HTML, and adds no hidden or
  // recipient-specific variation. Gmail visibility still requires a live
  // provider canary; no offline renderer can promise a client's trim policy.
  return `${bodyHtml}<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;border-collapse:collapse"><tbody><tr><td style="padding:0;font-size:10px;color:#595959;line-height:1.5">${inner}</td></tr></tbody></table>`;
}
