/** Minimal, deliberately boring HTML alternative for multipart email. */
const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export function htmlOfText(bodyText: string): string {
  const [body, footer] = bodyText.split('\n\n---\n', 2);
  const block = (text: string) =>
    escapeHtml(text).replaceAll('\n\n', '</p><p>').replaceAll('\n', '<br>');
  const bodyHtml = `<p>${block(body ?? '')}</p>`;
  return footer === undefined
    ? bodyHtml
    : `${bodyHtml}<p style="font-size:11px;color:#666;line-height:1.45">${block(footer)}</p>`;
}
