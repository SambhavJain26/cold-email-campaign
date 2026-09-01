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
  return `${bodyHtml}<p style="margin:16px 0 0;font-size:10px;color:#767676;line-height:1.5">${inner}</p>`;
}
