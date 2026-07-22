// Environment config: parsed once at boot, validated with zod, fail-loud.
// Reference table: docs/16-deployment-ops.md §1. Operator-tunable runtime
// values live in the `settings` DB row, NOT here (docs/02 §5).
import { z } from 'zod';
import { loadDotenv } from './dotenv';

const hexKey32 = z
  .string()
  .regex(/^[0-9a-f]{64}$/i, 'must be 32 bytes as 64 hex chars (see .env.example for generator)');

export const envSchema = z.object({
  // required
  DATABASE_URL: z.url(),
  SECRET_KEY: hexKey32,
  SESSION_KEY: hexKey32,
  OPERATOR_EMAIL: z.email(),
  OPERATOR_INITIAL_PASSWORD: z.string().min(8),
  // wiring
  MAIL_TRANSPORT: z.enum(['mock', 'smtp_imap']).default('mock'),
  ROLE: z.enum(['all', 'api', 'worker']).default('all'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  BACKUP_DIR: z.string().default('/var/backups/coldemail'),
  // optional
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ALERT_WEBHOOK_URL: z.url().optional(),
  TEST_DATABASE_URL: z.url().optional(),
});

export type Config = z.infer<typeof envSchema>;

export interface ParseEnvFailure {
  success: false;
  issues: string[];
}
export interface ParseEnvSuccess {
  success: true;
  config: Config;
}

/** Pure parse — used by tests and loadConfig. Empty strings count as unset. */
export function parseEnv(
  source: Record<string, string | undefined>,
): ParseEnvSuccess | ParseEnvFailure {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ''),
  );
  const result = envSchema.safeParse(cleaned);
  if (result.success) return { success: true, config: result.data };
  return {
    success: false,
    issues: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

/** Boot entry: load .env, parse, and exit(1) with every problem listed on failure. */
export function loadConfig(): Config {
  loadDotenv();
  const result = parseEnv(process.env);
  if (!result.success) {
    console.error('Invalid environment configuration:');
    for (const issue of result.issues) console.error(`  - ${issue}`);
    console.error('See .env.example and docs/16-deployment-ops.md §1.');
    process.exit(1);
  }
  return result.config;
}
