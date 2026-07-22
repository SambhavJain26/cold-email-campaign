// B5.2: CSV contract (docs/09 §1) - aliases, BOM, delimiter sniffing,
// custom-field preservation, limits.
import { describe, expect, it } from 'vitest';
import {
  CsvContractError,
  ImportTooLargeError,
  MAX_ROWS,
  parseCsv,
  sniffDelimiter,
  toSnakeCase,
} from '../../src/ingest/parse';

const buf = (s: string): Buffer => Buffer.from(s, 'utf8');

describe('header aliasing', () => {
  it('maps aliases case-insensitively to canonical fields', async () => {
    const rows = await parseCsv(
      buf('E-Mail,FirstName,Surname,Brokerage,URL\njo@x.dev,Jo,Doe,Acme,acme.dev\n'),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fields).toEqual({
      email: 'jo@x.dev',
      first_name: 'Jo',
      last_name: 'Doe',
      company: 'Acme',
      website: 'acme.dev',
    });
  });

  it('unmapped headers land in custom_fields under lowercase_snake_case', async () => {
    const rows = await parseCsv(buf('email,Deal Size ($),Region Code\njo@x.dev,50k,TX-N\n'));
    expect(rows[0]!.customFields).toEqual({ deal_size: '50k', region_code: 'TX-N' });
  });

  it('two headers aliasing one field: first non-empty value wins', async () => {
    const rows = await parseCsv(buf('email,work_email\n,jo@x.dev\na@x.dev,b@x.dev\n'));
    expect(rows[0]!.fields.email).toBe('jo@x.dev');
    expect(rows[1]!.fields.email).toBe('a@x.dev');
  });

  it('rejects a file with no email header', async () => {
    await expect(parseCsv(buf('name,company\nJo,Acme\n'))).rejects.toThrow(CsvContractError);
  });
});

describe('format tolerance', () => {
  it('BOM is stripped from the first header', async () => {
    const rows = await parseCsv(buf('﻿email,first_name\njo@x.dev,Jo\n'));
    expect(rows[0]!.fields.email).toBe('jo@x.dev');
  });

  it('semicolon and tab delimiters are auto-detected', async () => {
    expect(sniffDelimiter('email;first_name;company')).toBe(';');
    expect(sniffDelimiter('email\tfirst_name\tcompany')).toBe('\t');
    expect(sniffDelimiter('email,first_name')).toBe(',');
    const rows = await parseCsv(buf('email;first_name\njo@x.dev;Jo\n'));
    expect(rows[0]!.fields).toEqual({ email: 'jo@x.dev', first_name: 'Jo' });
  });

  it('ragged rows read missing cells as empty; empty lines are skipped', async () => {
    const rows = await parseCsv(buf('email,first_name,company\njo@x.dev\n\nb@x.dev,Bo,Beta\n'));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.fields).toEqual({ email: 'jo@x.dev' });
    expect(rows[1]!.fields.company).toBe('Beta');
  });

  it('values are trimmed; row numbers are 1-based in file order', async () => {
    const rows = await parseCsv(buf('email , first_name \n  jo@x.dev ,  Jo \n'));
    expect(rows[0]).toMatchObject({ rowNo: 1, fields: { email: 'jo@x.dev', first_name: 'Jo' } });
  });
});

describe('limits (docs/09 §1)', () => {
  it('rejects > 10 MB uploads', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 97);
    await expect(parseCsv(big)).rejects.toThrow(ImportTooLargeError);
  });

  it(`rejects > ${MAX_ROWS} rows mid-stream`, async () => {
    const lines = ['email'];
    for (let i = 0; i <= MAX_ROWS; i++) lines.push(`l${i}@x.dev`);
    await expect(parseCsv(buf(lines.join('\n')))).rejects.toThrow(ImportTooLargeError);
  });
});

describe('toSnakeCase', () => {
  it('normalizes arbitrary headers', () => {
    expect(toSnakeCase(' Deal Size ($) ')).toBe('deal_size');
    expect(toSnakeCase('LinkedIn-URL')).toBe('linkedin_url');
    expect(toSnakeCase('__weird__')).toBe('weird');
  });
});
