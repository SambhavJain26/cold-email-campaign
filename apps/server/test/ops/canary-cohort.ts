// Set up and probe canary cohorts through the real SERVICES (docs/17 §§3, 5).
//
// It deliberately does not go over HTTP. The API layer is thin and already has
// full test coverage; what the canary is validating is the ingest/enrollment/
// scheduler behaviour underneath it. Going through the services keeps every
// hygiene, dedup, suppression and ramp rule in play while skipping only auth.
//
//   npx tsx test/ops/canary-cohort.ts add-lead <email>          # single-lead path
//   npx tsx test/ops/canary-cohort.ts import <csv-path>         # bulk ingest
//   npx tsx test/ops/canary-cohort.ts capacity <campaignId>
//   npx tsx test/ops/canary-cohort.ts enroll <campaignId> <count>
//   npx tsx test/ops/canary-cohort.ts recycle <targetId> <sourceId>
//
// WRITES REAL CAMPAIGN STATE. Canary use only.
import { readFileSync } from 'node:fs';
import { loadConfig } from '../../src/config/env';
import { compose } from '../../src/composition';
import { createSingleLead, createImportPreview, commitImport } from '../../src/ingest/service';
import { capacityToday, enroll, recycle } from '../../src/services/enrollment';

async function main(): Promise<void> {
  const [command, a, b] = process.argv.slice(2);
  const config = loadConfig();
  const services = compose(config, {});
  const { db, clock, sequences, store } = services;
  const deps = { db, clock, sequences, store };

  try {
    switch (command) {
      case 'add-lead': {
        // Finding 10's path. A refusal here IS the result — it proves the
        // single-lead route cannot bypass the hygiene the CSV path enforces.
        console.log(JSON.stringify(await createSingleLead({ db }, { email: a! })));
        break;
      }
      case 'import': {
        const preview = await createImportPreview(
          { db },
          { filename: a!, content: readFileSync(a!) },
        );
        console.log('preview', JSON.stringify(preview.counts));
        const result = await commitImport(
          { db },
          { importId: preview.importId, mode: 'drop_flagged' },
        );
        console.log('commit', JSON.stringify(result));
        break;
      }
      case 'capacity': {
        console.log(JSON.stringify(await capacityToday(deps, Number(a))));
        break;
      }
      case 'enroll': {
        console.log(JSON.stringify(await enroll(deps, Number(a), Number(b))));
        break;
      }
      case 'recycle': {
        // Decision Q: blocked when a lead would receive a content hash it has
        // already had. The error names the offending steps.
        try {
          console.log(JSON.stringify(await recycle(deps, Number(a), Number(b))));
        } catch (err) {
          console.log(`REFUSED: ${(err as Error).name}: ${(err as Error).message}`);
        }
        break;
      }
      default:
        console.error('usage: canary-cohort.ts add-lead|import|capacity|enroll|recycle …');
        process.exitCode = 1;
    }
  } finally {
    await services.transport.close?.();
    await services.pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
