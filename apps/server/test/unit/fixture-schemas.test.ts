// B6.13 lockstep: the committed B2.18 fixtures must PARSE against the shared
// response schemas - pinning schema ⇔ fixture ⇔ contract together. A red here
// means docs/10, packages/shared, or the exported fixtures diverged.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { z } from 'zod';
import {
  campaignsListResponseSchema,
  dailySeriesRowSchema,
  mailboxVolumeResponseSchema,
  outcomesResponseSchema,
  overviewResponseSchema,
  stepAnalyticsRowSchema,
  tierAnalyticsRowSchema,
} from '@coldemail/shared';

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../web/src/mocks/fixtures/golden',
);

const load = (name: string): unknown => JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'));

describe('fixture ⇔ schema lockstep (decision H)', () => {
  const cases: Array<[string, z.ZodType]> = [
    ['overview.json', overviewResponseSchema],
    ['outcomes.json', outcomesResponseSchema],
    ['campaigns.json', campaignsListResponseSchema],
    ['analytics-steps.json', z.array(stepAnalyticsRowSchema)],
    ['analytics-tiers.json', z.array(tierAnalyticsRowSchema)],
    ['health-trend.json', z.array(dailySeriesRowSchema)],
    ['mailbox-volume.json', mailboxVolumeResponseSchema],
  ];

  for (const [file, schema] of cases) {
    it(`${file} parses against its shared schema`, () => {
      const result = schema.safeParse(load(file));
      if (!result.success) {
        throw new Error(`${file}: ${JSON.stringify(result.error.issues, null, 2)}`);
      }
    });
  }
});
