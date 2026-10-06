/** Minimal, deliberately boring HTML alternative for multipart email. */
export const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** Render the original body and known appended blocks without guessing boundaries. */
export function htmlOfText(body: string, footerHtml: string, signatureHtml: string): string {
  const content = body.trimEnd();
  const paragraphs = content
    .split('\n\n')
    .map(
      (paragraph, index, all) =>
        `<p style="margin:0 0 ${index === all.length - 1 ? '0' : '16px'}">${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`,
    )
    .join('');
  return `${paragraphs}<p style="margin:16px 0 0">${signatureHtml}<br>${footerHtml}</p>`;
}
