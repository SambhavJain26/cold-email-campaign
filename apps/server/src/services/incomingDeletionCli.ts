import { access } from 'node:fs/promises';
import { loadDotenv } from '../config/dotenv';
import { createDb } from '../db/client';
import { reapplyDeletionManifest } from './incomingContent';

async function main(): Promise<void> {
  loadDotenv();
  const url = process.env.DATABASE_URL;
  const file = process.env.INCOMING_DELETION_MANIFEST_PATH;
  if (!url || !file)
    throw new Error(
      'DATABASE_URL and the latest INCOMING_DELETION_MANIFEST_PATH are required for restore reconciliation.',
    );
  await access(file); // A missing restore manifest is an error, never an empty deletion history.
  const { db, pool } = createDb(url);
  try {
    console.log(
      `reapplied ${await reapplyDeletionManifest(db, file)} incoming-content deletion intents`,
    );
  } finally {
    await pool.end();
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Deletion reconciliation failed.');
  process.exitCode = 1;
});
