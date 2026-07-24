// CLI: npm run rotate-secrets -- --new-key <hex>
// Re-seals every mailbox secret from the current SECRET_KEY (env) to the given
// new key in one transaction (runbook docs/16 §3). After it succeeds, update
// SECRET_KEY in the env file to the new value and restart — the old key no
// longer unseals anything. Exits 1 on any failure (tx rolled back).
import { loadDotenv } from '../config/dotenv';
import { createDb } from '../db/client';
import { rotateSecrets } from './rotateSecrets';

function flagValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  loadDotenv();
  const url = process.env.DATABASE_URL;
  const oldKey = process.env.SECRET_KEY;
  const newKey = flagValue('--new-key');

  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  if (!oldKey) {
    console.error('SECRET_KEY (the current key) is not set in the environment');
    process.exit(1);
  }
  if (!newKey) {
    console.error('usage: npm run rotate-secrets -- --new-key <64-hex-chars>');
    console.error(
      "generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
    process.exit(1);
  }

  const { db, pool } = createDb(url);
  try {
    const { rotated } = await rotateSecrets(db, oldKey, newKey, new Date());
    console.log(`re-sealed ${rotated} mailbox secret(s) under the new key.`);
    console.log('Next: set SECRET_KEY to the new value in your env file and restart the app.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
