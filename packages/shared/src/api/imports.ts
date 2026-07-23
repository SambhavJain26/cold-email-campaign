// Import endpoints (docs/10 §Leads & imports, docs/09). POST /imports is
// multipart CSV - no body schema here; the response shapes are the contract.
import { z } from 'zod';
import { isoDateTime, listOf } from './common';

export const IMPORT_ROW_FLAGS = [
  'ok',
  'missing_first_name',
  'role_based',
  'invalid',
  'duplicate',
  'suppressed',
] as const;
export type ImportRowFlag = (typeof IMPORT_ROW_FLAGS)[number];

/** Per docs/03: `ok` is the IMPORTABLE-CLEAN display number (includes missing_first_name). */
export const importCountsSchema = z
  .object({
    ok: z.number().int().min(0),
    missing_first_name: z.number().int().min(0),
    role_based: z.number().int().min(0),
    invalid: z.number().int().min(0),
    duplicate: z.number().int().min(0),
    suppressed: z.number().int().min(0),
  })
  .strict();
export type ImportCountsDto = z.infer<typeof importCountsSchema>;

export const importSampleRowSchema = z
  .object({ row_no: z.number().int(), email: z.string().nullable() })
  .strict();

export const importPreviewResponseSchema = z
  .object({
    import_id: z.number().int(),
    counts: importCountsSchema,
    samples: z.partialRecord(z.enum(IMPORT_ROW_FLAGS), z.array(importSampleRowSchema)),
  })
  .strict();

export const commitImportBodySchema = z
  .object({ mode: z.enum(['drop_flagged', 'import_all']) })
  .strict();
export type CommitImportBody = z.infer<typeof commitImportBodySchema>;

export const commitImportResponseSchema = z.object({ imported: z.number().int().min(0) }).strict();

export const importSchema = z
  .object({
    id: z.number().int(),
    filename: z.string(),
    rows_total: z.number().int(),
    counts: importCountsSchema,
    committed: z.boolean(),
    commit_mode: z.enum(['drop_flagged', 'import_all']).nullable(),
    created_at: isoDateTime,
  })
  .strict();
export type ImportDto = z.infer<typeof importSchema>;

export const importsListResponseSchema = listOf(importSchema);
