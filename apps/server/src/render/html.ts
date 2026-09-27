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
  const joined = content.split(/\r?\n/).at(-1)?.trim() === 'Best,';
  const identity = joined
    ? paragraphs.replace(/<\/p>$/, () => `<br>${signatureHtml}</p>`)
    : `${paragraphs}<p style="margin:16px 0 0">${signatureHtml}</p>`;
  return `${identity}<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;border-collapse:collapse"><tbody><tr><td style="padding:0;font-size:10px;color:#767676;line-height:1.5">${footerHtml}</td></tr></tbody></table>`;
}
