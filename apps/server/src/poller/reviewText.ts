import type { IncomingMessage } from '../transport/types';

export const MAX_INCOMING_CONTENT_BYTES = 5 * 1024 * 1024;

/** Conservative display extraction. Never inspect identified history or signatures for requests. */
export function extractNewText(text: string): {
  newText: string;
  quotedText: string;
  uncertain: boolean;
} {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const newLines: string[] = [];
  const history: string[] = [];
  let ended = false;
  for (const line of lines) {
    if (
      /^\s*(?:On .+wrote:|[-_]{2,}\s*(?:Original|Forwarded) message|Begin forwarded message:|From:\s*.+@|--\s*$|(?:Best(?: regards)?|Kind regards|Regards|Sincerely|Thanks),?\s*$)/i.test(
        line,
      )
    )
      ended = true;
    if (ended || /^\s*>/.test(line)) history.push(line);
    else newLines.push(line);
  }
  return {
    newText: newLines.join('\n').trim(),
    quotedText: history.join('\n').trim(),
    uncertain:
      /\b(?:wrote|forwarded message)\b/i.test(newLines.join('\n')) ||
      /[“”"].*\b(?:unsubscribe|stop|remove me)\b.*[“”"]/i.test(newLines.join('\n')),
  };
}

export function explicitOptOut(text: string, uncertain = false): string | null {
  if (uncertain) return null;
  const normalized = text.toLowerCase().replace(/[’‘]/g, "'").trim();
  if (/^stop[.!]?$/i.test(normalized)) return 'standalone_stop';
  const request =
    /^(?:please\s+)?(?:unsubscribe(?:\s+me)?|remove me from (?:your|the|this) (?:mailing |email |contact )?list|take me off (?:your|the|this) (?:mailing |email |contact )?list|stop (?:contacting|emailing|messaging) me|no more emails(?: please)?|(?:do not|don't) (?:contact|email|message|reach out to) me(?: again| anymore| any more)?)[.!]?$/i;
  return normalized.split(/\n|(?<=[.!?])\s+/).some((line) => request.test(line.trim()))
    ? 'direct_optout'
    : null;
}

export function automationLabel(m: IncomingMessage): 'automatic' | 'not_detected' | 'uncertain' {
  if (m.contentStatus === 'unavailable') return 'uncertain';
  const submitted = m.headers['auto-submitted']?.trim().toLowerCase();
  if (
    (submitted && submitted !== 'no') ||
    'x-autoreply' in m.headers ||
    'x-autorespond' in m.headers
  )
    return 'automatic';
  if (/out of (?:the )?office|automatic reply|auto[- ]reply|on vacation/i.test(m.subject))
    return 'uncertain';
  return 'not_detected';
}
