import { senderIdentity } from './companyStop';

export function replySubject(value: string | null | undefined): string {
  let subject = (value ?? '').trim();
  const prefix =
    /^(?:re|fw|fwd|auto response|automatic reply)\s*:\s*|^out of office(?:\s*:\s*|\s+|$)/i;
  while (prefix.test(subject)) subject = subject.replace(prefix, '').trim();
  return subject.toLowerCase().replace(/\s+/g, ' ');
}
export function specificSubject(value: string): boolean {
  const generic = new Set([
    'hello',
    'thank you',
    'thanks',
    'out of office',
    'thank you very much',
    'thanks for your email',
    'thank you for your email',
  ]);
  return (
    !generic.has(value) &&
    value.split(/\s+/).filter((word) => /\p{L}/u.test(word)).length >= 3 &&
    (value.match(/\p{L}/gu)?.length ?? 0) >= 12
  );
}
export function candidateEvidence(
  from: string,
  subject: string | null,
  email: string,
  sentSubject: string | null,
) {
  const normalized = replySubject(subject);
  return {
    subject_match: specificSubject(normalized) && normalized === replySubject(sentSubject),
    company_match:
      !!senderIdentity(from).company &&
      senderIdentity(from).company === senderIdentity(email).company,
  };
}
