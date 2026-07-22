// Regenerate the committed fixture CSV — run deliberately only:
//   npx tsx test/fixtures/ingest/write.ts   (from apps/server)
// The split test locks generator ⇔ committed file; regenerating without a
// reason will show up as a diff there.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateFixtureCsv } from './generate';

const out = join(dirname(fileURLToPath(import.meta.url)), 'real_estate_leads.csv');
writeFileSync(out, generateFixtureCsv(), 'utf8');
console.log(`wrote ${out}`);
