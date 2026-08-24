// Import route group (B6.4, docs/10 §Leads & imports, docs/09): multipart CSV
// upload → persisted preview → commit. Neither phase appends events (imports
// are not lead-history facts — docs/10 traceability).
import fastifyMultipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import {
  commitImportBodySchema,
  commitImportResponseSchema,
  idParamSchema,
  importPreviewResponseSchema,
  importDraftPreviewQuerySchema,
  importDraftPreviewResponseSchema,
  importsListResponseSchema,
  pageQuerySchema,
  type ImportDto,
} from '@coldemail/shared';
import type { AppServices } from '../composition';
import { getImport, listImports, type ImportRow } from '../db/repos/importsRepo';
import { commitImport, createImportPreview, previewImportDrafts } from '../ingest/service';
import { getCampaign } from '../db/repos/campaignsRepo';
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
        draft_counts: {
          new_leads: preview.draftCounts.newLeads,
          existing_leads: preview.draftCounts.existingLeads,
          valid_drafts: preview.draftCounts.validDrafts,
          invalid_drafts: preview.draftCounts.invalidDrafts,
        },
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
      if (req.body.draft_campaign_id !== undefined) {
        const campaign = await getCampaign(db, req.body.draft_campaign_id);
        if (!campaign) throw AppError.notFound('campaign');
      }
      const result = await commitImport(
        { db },
        {
          importId: req.params.id,
          mode: req.body.mode,
          draftCampaignId: req.body.draft_campaign_id,
          replaceExistingDrafts: req.body.replace_existing_drafts,
        },
      );
      return {
        imported: result.inserted,
        leads_created: result.inserted,
        drafts_created: result.draftsCreated,
        drafts_replaced: result.draftsReplaced,
        drafts_skipped: result.draftsSkipped,
        invalid_drafts: result.invalidDrafts,
      };
    },
  );

  r.get(
    '/imports/:id/draft-preview',
    {
      schema: {
        params: idParamSchema,
        querystring: importDraftPreviewQuerySchema,
        response: { 200: importDraftPreviewResponseSchema },
      },
    },
    async (req) => {
      if (!(await getImport(db, req.params.id))) throw AppError.notFound('import');
      if (!(await getCampaign(db, req.query.campaign_id))) throw AppError.notFound('campaign');
      const preview = await previewImportDrafts(
        { db },
        { importId: req.params.id, campaignId: req.query.campaign_id },
      );
      return {
        new_leads: preview.newLeads,
        existing_leads: preview.existingLeads,
        valid_drafts: preview.validDrafts,
        invalid_drafts: preview.invalidDrafts,
        existing_draft_conflicts: preview.existingDraftConflicts,
      };
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
