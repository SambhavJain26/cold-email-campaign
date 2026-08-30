/**
 * Populate the disposable test database with a small event-ledger-consistent cohort.
 * This intentionally leaves the rows in place so the real rebuild CLI can prove that
 * it checked populated state rather than reporting a vacuous zero-enrollment result.
 */
import { scenario } from '../helpers/scenario';
import { testSequence } from '../helpers/sequences';

const cohort = await scenario({
  mailboxes: 2,
  sequence: testSequence(1, [0, 3, 4]),
  seed: 20260825,
});

try {
  await cohort.importLeads(5, { tiers: { A: 2, B: 3 } });
  const enrolled = await cohort.enroll({ count: 5 });
  console.log(`seeded ${enrolled.length} event-backed enrollments for projection verification`);
} finally {
  await cohort.close();
}
