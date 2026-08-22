/** Resolve a configured unsubscribe host for the mailbox doing the send. */
export function resolveUnsubscribeBaseUrl(template: string, senderAddress: string): string {
  const trimmed = template.trim();
  if (trimmed === '') return '';
  const at = senderAddress.lastIndexOf('@');
  if (at < 1 || at === senderAddress.length - 1) {
    throw new Error('sender mailbox has no domain');
  }
  const senderDomain = senderAddress
    .slice(at + 1)
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(senderDomain) || !senderDomain.includes('.')) {
    throw new Error('sender mailbox has an invalid domain');
  }
  return trimmed.replace('{sender_domain}', senderDomain);
}
