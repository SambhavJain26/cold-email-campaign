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
  const [body, footer] = bodyText.split('\n\n---\n', 2);
  const block = (text: string) =>
    escapeHtml(text).replaceAll('\n\n', '</p><p>').replaceAll('\n', '<br>');
  const bodyHtml = `<p>${block(body ?? '')}</p>`;
  if (footer === undefined) return bodyHtml;
  const inner = footerHtml ?? block(footer);
  return `${bodyHtml}<p style="font-size:11px;color:#666;line-height:1.45">${inner}</p>`;
}
