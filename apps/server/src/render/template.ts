// Template tokenizer + validator (docs/08 §2). Single pass; exported
// standalone because the Sequence-Builder live-validation endpoint (B6.5)
// calls parseTemplate directly.
//
//   merge-tag  := '{{' field ('|' fallback)? '}}'
//   spintax    := '{{RANDOM|' option ('|' option)+ '}}'
//
// Escaping: '\{\{' renders literal '{{'. Nested tags are unsupported (fatal).
// A non-RANDOM tag's fallback is everything after the FIRST '|' — it may
// itself contain '|' characters.

export type TemplateToken =
  | { kind: 'text'; value: string }
  | { kind: 'tag'; field: string; fallback: string | null; offset: number }
  | { kind: 'random'; options: string[]; offset: number };

export interface TemplateError {
  message: string;
  /** Character offset of the offending '{{' in the source template. */
  offset: number;
}

export interface ParsedTemplate {
  tokens: TemplateToken[];
  errors: TemplateError[];
}

const ESCAPE = '\\{\\{'; // renders literal '{{'

export function parseTemplate(src: string): ParsedTemplate {
  const tokens: TemplateToken[] = [];
  const errors: TemplateError[] = [];
  let text = '';
  let i = 0;

  const flush = (): void => {
    if (text !== '') {
      tokens.push({ kind: 'text', value: text });
      text = '';
    }
  };

  while (i < src.length) {
    if (src.startsWith(ESCAPE, i)) {
      text += '{{';
      i += ESCAPE.length;
      continue;
    }
    if (!src.startsWith('{{', i)) {
      text += src[i];
      i += 1;
      continue;
    }

    const close = src.indexOf('}}', i + 2);
    if (close === -1) {
      errors.push({ message: 'unclosed tag', offset: i });
      text += src.slice(i); // keep the raw text visible in previews
      break;
    }
    const inner = src.slice(i + 2, close);
    if (inner.includes('{{')) {
      errors.push({ message: 'nested tags are unsupported', offset: i });
      i = close + 2;
      continue;
    }

    flush();
    if (inner.startsWith('RANDOM|') || inner === 'RANDOM') {
      const options = inner === 'RANDOM' ? [] : inner.slice('RANDOM|'.length).split('|');
      if (options.length < 2) {
        errors.push({ message: 'spintax needs at least 2 options', offset: i });
      } else {
        tokens.push({ kind: 'random', options, offset: i });
      }
    } else {
      const pipe = inner.indexOf('|');
      const field = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
      const fallback = pipe === -1 ? null : inner.slice(pipe + 1);
      if (field === '') {
        errors.push({ message: 'empty merge tag', offset: i });
      } else {
        tokens.push({ kind: 'tag', field, fallback, offset: i });
      }
    }
    i = close + 2;
  }
  flush();
  return { tokens, errors };
}

/** Π of spintax option-counts across the given parses (docs/08 §2 variation count). */
export function variationCount(...parses: ParsedTemplate[]): number {
  let n = 1;
  for (const p of parses) {
    for (const t of p.tokens) {
      if (t.kind === 'random') n *= t.options.length;
    }
  }
  return n;
}
