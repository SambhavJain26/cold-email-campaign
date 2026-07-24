// The locked-out recovery path (docs/16 §3 runbook):
//
//   npm run operator:set-password -- --password '<new password>'
//   NEW_PASSWORD='<new password>' npm run operator:set-password
//
// `ensureOperator` seeds the operator row ONCE at first boot, so editing
// OPERATOR_INITIAL_PASSWORD in the env afterwards does nothing - without this
// CLI a forgotten password means hand-editing the database.
//
// The password is read from --password or $NEW_PASSWORD; prefer the env form so
// it doesn't land in shell history. It is never logged, and only its argon2id
// hash is written.
import { loadConfig } from '../config/env';
import { createDb } from '../db/client';
import { getOperator, updatePasswordHash } from '../db/repos/operatorRepo';
import { hashPassword } from './operatorAuth';

const MIN_LENGTH = 8;

function readPassword(argv: string[]): string | null {
  const flag = argv.indexOf('--password');
  if (flag !== -1 && argv[flag + 1] !== undefined) return argv[flag + 1]!;
  const fromEnv = process.env.NEW_PASSWORD;
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : null;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const password = readPassword(argv);
  if (password === null) {
    console.error(
      'Usage: npm run operator:set-password -- --password <new password>\n' +
        '   or: NEW_PASSWORD=<new password> npm run operator:set-password',
    );
    return 1;
  }
  if (password.length < MIN_LENGTH) {
    console.error(`Password must be at least ${MIN_LENGTH} characters.`);
    return 1;
  }

  const config = loadConfig();
  const { db, pool } = createDb(config.DATABASE_URL);
  try {
    const operator = await getOperator(db);
    if (!operator) {
      console.error('No operator row exists yet - boot the app once to seed it.');
      return 1;
    }
    await updatePasswordHash(db, await hashPassword(password), new Date());
    console.log(`Password updated for ${operator.email}.`);
    return 0;
  } finally {
    await pool.end();
  }
}

// Only run when invoked as a script (the test imports `main` directly).
if (process.argv[1]?.endsWith('operatorSetPasswordCli.ts')) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
