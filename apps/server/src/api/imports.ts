// Import route group (B6.4, docs/10 §Leads & imports, docs/09): multipart CSV
// upload → persisted preview → commit. Neither phase appends events (imports
// are not lead-history facts - docs/10 traceability).
import fastifyMultipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import {
  commitImportBodySchema,
  commitImportResponseSchema,
  idParamSchema,
  importPreviewResponseSchema,
  importsListResponseSchema,
  pageQuerySchema,
  type ImportDto,
} from '@coldemail/shared';
import type { AppServices } from '../composition';
import { getImport, listImports, type ImportRow } from '../db/repos/importsRepo';
import { commitImport, createImportPreview } from '../ingest/service';
import { MAX_BYTES } from '../ingest/parse';
import { AppError } from './errors';
import type { ZodTypeProvider } from './plugins/zodCompilers';

function toImportDto(row: ImportRow): ImportDto {
  return {
    id: row.id,
    filename: row.filename,
    rows_total: row.rowsTotal,
    counts: row.counts,
    committed: row.committed,
    commit_mode: row.commitMode as ImportDto['commit_mode'],
    created_at: row.createdAt.toISOString(),
  };
}

export async function importsRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db } = services;

  // Registered here, not app-wide: only this group consumes multipart. Limits
  // mirror the ingest caps (docs/09 §1) so oversize dies at the socket.
  await app.register(fastifyMultipart, {
    limits: { files: 1, fileSize: MAX_BYTES },
  });

  r.post(
    '/imports',
    { schema: { response: { 200: importPreviewResponseSchema } } },
    async (req) => {
      const file = await req.file();
      if (!file) throw new AppError('validation', 400, 'multipart CSV file required');
      let content: Buffer;
      try {
        content = await file.toBuffer();
      } catch (err) {
        if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
          throw new AppError('import_too_large', 413, `CSV exceeds ${MAX_BYTES} bytes`);
        }
        throw err;
      }
      const preview = await createImportPreview({ db }, { filename: file.filename, content });
      return {
        import_id: preview.importId,
        counts: preview.counts,
        samples: Object.fromEntries(
          Object.entries(preview.samples).map(([flag, rows]) => [
            flag,
            rows.map((s) => ({ row_no: s.rowNo, email: s.email })),
          ]),
        ),
      };
    },
  );

  r.post(
    '/imports/:id/commit',
    {
      schema: {
        params: idParamSchema,
        body: commitImportBodySchema,
        response: { 200: commitImportResponseSchema },
      },
    },
    async (req) => {
      const imp = await getImport(db, req.params.id);
      if (!imp) throw AppError.notFound('import');
      if (imp.committed) {
        throw new AppError('conflict', 409, `import ${imp.id} already committed`);
      }
      const result = await commitImport({ db }, { importId: req.params.id, mode: req.body.mode });
      return { imported: result.inserted };
    },
  );

  r.get(
    '/imports',
    { schema: { querystring: pageQuerySchema, response: { 200: importsListResponseSchema } } },
    async (req) => {
      const { page, per_page } = req.query;
      const { items, total } = await listImports(db, page, per_page);
      return { items: items.map(toImportDto), total, page, per_page };
    },
  );
}
