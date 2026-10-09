import { loadDotenv } from '../config/dotenv';
import { createDb } from '../db/client';
import { scanPossibleReplies } from './possibleReplies';

async function main() {
  loadDotenv();
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const args = process.argv.slice(2);
  if (args.some((a) => a !== '--apply' && !/^--message=\d+$/.test(a)))
    throw new Error(
      'Use --apply and optional --message=ID flags. Default is metadata preview only.',
    );
  const ids = args.filter((a) => a.startsWith('--message=')).map((a) => Number(a.split('=')[1]));
  const { db, pool } = createDb(process.env.DATABASE_URL);
  try {
    console.log(
      JSON.stringify({
        mode: args.includes('--apply') ? 'metadata-only apply' : 'preview',
        items: await scanPossibleReplies(
          db,
          new Date(),
          args.includes('--apply'),
          ids.length ? ids : undefined,
        ),
      }),
    );
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Candidate scan failed');
  process.exitCode = 1;
});
