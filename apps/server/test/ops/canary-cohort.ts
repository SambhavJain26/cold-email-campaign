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
import { createSequence } from '../../src/db/repos/sequencesRepo';
import { resumeMailbox } from '../../src/services/autoPause';
import { createCampaign, patchCampaign } from '../../src/db/repos/campaignsRepo';
import { contentHashOf } from '../../src/render/hash';

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
      case 'create-sequence': {
        // Two steps with waitDays 0: step 2 is due immediately, which is what
        // proves the distinction §3 exists to test — a human reply stops the
        // sequence, an auto-reply does not. contentHash is computed here
        // because the CALLER owns it (decision Q) and the recycle guard
        // compares against exactly this value.
        const step = (n: number, subject: string, body: string) => ({
          stepNo: n,
          waitDays: 0,
          inThread: n > 1,
          variants: [
            {
              label: 'A',
              subjectTemplate: subject,
              bodyTemplate: body,
              contentHash: contentHashOf(subject, body),
              active: true,
            },
          ],
        });
        const id = await createSequence(db, {
          name: a ?? 'Canary Cohort Sequence',
          stopOnReply: true,
          steps: [
            step(
              1,
              'Quick note for {{company|your team}}',
              'Hi {{first_name|there}}, I work with property teams in {{city|your area}} on outreach that does not read like a template. We keep it to plain text, one idea per message, and we stop the moment someone replies. If that is useful I can share what the sequence looks like. If not, no hard feelings at all.',
            ),
            step(
              2,
              'Following on for {{company|your team}}',
              'Hi {{first_name|there}}, adding one concrete detail to my last note. The part teams tell us matters most is that replies stop the sequence immediately, so nobody gets chased after they have answered. Happy to send the outline over if it is worth a look, and equally happy to leave it here if the timing is wrong.',
            ),
          ],
        });
        console.log(JSON.stringify({ sequenceId: id }));
        break;
      }
      case 'create-campaign': {
        const row = await createCampaign(db, {
          name: a ?? 'Canary Cohort',
          sequenceId: Number(b),
          // Untiered leads map to template_auto regardless, but set every tier
          // explicitly so nothing lands in Tier-A manual mode by default and
          // silently never sends (finding 9).
          tierEffortConfig: { A: 'template_auto', B: 'template_auto', C: 'template_auto' },
          rampConfig: { ramp_days: 0, ramp_daily_enroll_cap: 0 },
        });
        await patchCampaign(db, row.id, { status: 'active' });
        console.log(JSON.stringify({ campaignId: row.id, status: 'active' }));
        break;
      }
      case 'resume': {
        // Operator resume (docs/06 §6): back to ok at capPct% of the daily cap.
        await resumeMailbox({ db }, Number(a), Number(b ?? 100), clock.now());
        console.log(JSON.stringify({ mailboxId: Number(a), capPct: Number(b ?? 100) }));
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
