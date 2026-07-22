// STOP / opt-out detection (B3.12, decision F, docs/07 §3). Pure module.
//
// The matcher runs on the UNQUOTED reply text only, inside the first 300
// chars. A bare "stop" is accepted only when the whole unquoted text is ≤ 40
// words - "we should stop losing leads to slow photo turnaround" must NOT
// match; longer texts require a stronger phrase.

const KEYWORDS =
  /\b(unsubscribe|remove me|take me off|opt me out|opt out|do not (?:email|contact) me|no longer (?:email|contact)|stop)\b/;

const QUOTE_INTRO = /^\s*On .{0,200}wrote:\s*$/i; // "On Mon, Jan 5 ... wrote:"
const OUTLOOK_SEPARATOR = /^_{5,}\s*$/; // "________________________________"
const SIGNATURE = /^--\s*$/;

/** Strip quoted original, reply intros, and signatures from a reply body. */
export function unquotedText(body: string): string {
  const kept: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (SIGNATURE.test(line)) break; // everything after "--" is signature
    if (QUOTE_INTRO.test(line)) break; // quoted original follows
    if (OUTLOOK_SEPARATOR.test(line)) break; // Outlook's quoted-header block follows
    if (line.trimStart().startsWith('>')) continue; // quoted line
    kept.push(line);
  }
  return kept.join('\n').trim();
}

export interface StopMatch {
  matched: boolean;
  keyword?: string;
}

export function detectStop(bodyText: string): StopMatch {
  const text = unquotedText(bodyText);
  const window = text.slice(0, 300).toLowerCase();
  const m = KEYWORDS.exec(window);
  if (!m) return { matched: false };
  const keyword = m[1]!;
  if (keyword === 'stop') {
    // Bare "stop" needs the guards below; but keep scanning - a stronger
    // phrase later in the window still counts on its own.
    const rest = window.slice(m.index + keyword.length);
    const stronger = KEYWORDS.exec(rest);
    if (stronger && stronger[1] !== 'stop') {
      return { matched: true, keyword: stronger[1]! };
    }
    // Guards (docs/07 §7): total text ≤ 40 words AND "stop" sits in a tiny
    // standalone clause ("STOP", "Please stop.") - never mid-sentence
    // ("we should stop losing leads…").
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount > 40) return { matched: false };
    const clause = window.split(/[.!?\n,;:]/).find((c) => /\bstop\b/.test(c));
    const clauseWords = clause?.split(/\s+/).filter(Boolean).length ?? Number.POSITIVE_INFINITY;
    if (clauseWords > 4) return { matched: false };
  }
  return { matched: true, keyword };
}
