// CSV contract (docs/09 §1): csv-parse streaming, BOM-tolerant, `,`/`;`/tab
// auto-detected from the header line. Header matching is case-insensitive via
// the alias map; unmapped headers land in custom_fields under their
// lowercase_snake_case name (usable as merge tags).
import { parse } from 'csv-parse';
import { Readable } from 'node:stream';

export const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_ROWS = 50_000;

export class ImportTooLargeError extends Error {
  readonly code = 'import_too_large';
  constructor(detail: string) {
    super(`import_too_large: ${detail}`);
  }
}

export class CsvContractError extends Error {
  readonly code: string;
  constructor(code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.code = code;
  }
}

export type CanonicalField =
  | 'email'
  | 'first_name'
  | 'last_name'
  | 'company'
  | 'website'
  | 'city'
  | 'state'
  | 'phone'
  | 'notes';

// Keys are the POST-toSnakeCase form of the accepted headers (docs/09 §1) —
// e.g. the "e-mail" alias arrives here as "e_mail".
const ALIASES: Record<string, CanonicalField> = {
  email: 'email',
  e_mail: 'email',
  email_address: 'email',
  work_email: 'email',
  first_name: 'first_name',
  firstname: 'first_name',
  first: 'first_name',
  given_name: 'first_name',
  last_name: 'last_name',
  lastname: 'last_name',
  last: 'last_name',
  surname: 'last_name',
  company: 'company',
  company_name: 'company',
  business: 'company',
  brokerage: 'company',
  website: 'website',
  url: 'website',
  domain: 'website',
  site: 'website',
  city: 'city',
  town: 'city',
  state: 'state',
  province: 'state',
  region: 'state',
  phone: 'phone',
  phone_number: 'phone',
  mobile: 'phone',
  telephone: 'phone',
  tel: 'phone',
  notes: 'notes',
  note: 'notes',
  comments: 'notes',
  comment: 'notes',
};

export interface ParsedRow {
  /** 1-based data-row number (header excluded) — file order. */
  rowNo: number;
  fields: Partial<Record<CanonicalField, string>>;
  customFields: Record<string, string>;
}

export function toSnakeCase(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Pick the delimiter with the most hits on the header line. */
export function sniffDelimiter(content: string): ',' | ';' | '\t' {
  const header = content.slice(content.charCodeAt(0) === 0xfeff ? 1 : 0).split(/\r?\n/, 1)[0]!;
  const counts: Array<[',' | ';' | '\t', number]> = [
    [',', header.split(',').length - 1],
    [';', header.split(';').length - 1],
    ['\t', header.split('\t').length - 1],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![0];
}

/**
 * Parse the whole upload. Throws ImportTooLargeError over 10 MB / 50k rows
 * (row cap enforced MID-STREAM — a huge file aborts early), CsvContractError
 * when no header maps to `email`.
 */
export async function parseCsv(buffer: Buffer): Promise<ParsedRow[]> {
  if (buffer.byteLength > MAX_BYTES) {
    throw new ImportTooLargeError(`${buffer.byteLength} bytes (max ${MAX_BYTES})`);
  }
  const delimiter = sniffDelimiter(buffer.toString('utf8', 0, Math.min(buffer.length, 4096)));

  const parser = Readable.from(buffer).pipe(
    parse({
      bom: true,
      delimiter,
      columns: false,
      relaxColumnCount: true, // ragged rows: missing cells read as empty
      skipEmptyLines: true,
      trim: true,
    }),
  );

  let headerMap: Array<
    { kind: 'field'; field: CanonicalField } | { kind: 'custom'; key: string }
  > | null = null;
  const rows: ParsedRow[] = [];

  for await (const record of parser as AsyncIterable<string[]>) {
    if (headerMap === null) {
      headerMap = record.map((h) => {
        const key = toSnakeCase(h);
        const field = ALIASES[key];
        return field ? { kind: 'field' as const, field } : { kind: 'custom' as const, key };
      });
      if (!headerMap.some((m) => m.kind === 'field' && m.field === 'email')) {
        throw new CsvContractError('missing_email_column', 'no header maps to email');
      }
      continue;
    }
    if (rows.length >= MAX_ROWS) {
      throw new ImportTooLargeError(`more than ${MAX_ROWS} rows`);
    }
    const fields: Partial<Record<CanonicalField, string>> = {};
    const customFields: Record<string, string> = {};
    for (let i = 0; i < headerMap.length; i++) {
      const value = (record[i] ?? '').trim();
      if (value === '') continue;
      const m = headerMap[i]!;
      // first non-empty wins when two headers alias the same field
      if (m.kind === 'field') fields[m.field] ??= value;
      else if (m.key !== '') customFields[m.key] ??= value;
    }
    rows.push({ rowNo: rows.length + 1, fields, customFields });
  }
  return rows;
}
