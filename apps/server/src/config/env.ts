// Environment config: parsed once at boot, validated with zod, fail-loud.
// Reference table: docs/16-deployment-ops.md §1. Operator-tunable runtime
// values live in the `settings` DB row, NOT here (docs/02 §5).
import { z } from 'zod';
import { loadDotenv } from './dotenv';

const hexKey32 = z
  .string()
  .regex(/^[0-9a-f]{64}$/i, 'must be 32 bytes as 64 hex chars (see .env.example for generator)');

export const envSchema = z
  .object({
    // required
    DATABASE_URL: z.url(),
    SECRET_KEY: hexKey32,
    SESSION_KEY: hexKey32,
    OPERATOR_EMAIL: z.email(),
    OPERATOR_INITIAL_PASSWORD: z.string().min(8),
    // wiring
    MAIL_TRANSPORT: z.enum(['mock', 'smtp_imap']).default('mock'),
    /**
     * B8.1: accept self-signed certs / skip STARTTLS on the mail servers. For a
     * LOCAL test server (the GreenMail container) only — refused in production.
     */
    MAIL_TLS_INSECURE: z.stringbool().default(false),
    ROLE: z.enum(['all', 'api', 'worker']).default('all'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    HOST: z.string().default('127.0.0.1'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    BACKUP_DIR: z.string().default('/var/backups/coldemail'),
    /** Canonical browser-visible application URL, including any deployment subpath. */
    PUBLIC_APP_URL: z.url().default('http://localhost:5173'),
    /** Test-only (B6.12): VirtualClock + inline jobs + POST /system/advance-clock. */
    SIMULATED_CLOCK: z.stringbool().default(false),
    // optional
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    ALERT_WEBHOOK_URL: z.url().optional(),
    GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
    TEST_DATABASE_URL: z.url().optional(),
  })
  .superRefine((cfg, ctx) => {
    // A simulated clock against real SMTP/IMAP would burst-send the backlog —
    // refuse loudly (docs/13 §5: mock builds only).
    if (cfg.SIMULATED_CLOCK && cfg.MAIL_TRANSPORT === 'smtp_imap') {
      ctx.addIssue({
        code: 'custom',
        path: ['SIMULATED_CLOCK'],
        message: 'SIMULATED_CLOCK requires MAIL_TRANSPORT=mock',
      });
    }
    // Plaintext/unverified TLS to a real provider would leak the mailbox
    // password on the wire — the flag exists for the local GreenMail rig only.
    if (cfg.MAIL_TLS_INSECURE && cfg.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_TLS_INSECURE'],
        message: 'MAIL_TLS_INSECURE is refused in production (local test servers only)',
      });
    }
    if (cfg.SIMULATED_CLOCK && cfg.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['SIMULATED_CLOCK'],
        message: 'SIMULATED_CLOCK is refused in production',
      });
    }
    if (Boolean(cfg.GOOGLE_OAUTH_CLIENT_ID) !== Boolean(cfg.GOOGLE_OAUTH_CLIENT_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_OAUTH_CLIENT_ID'],
        message: 'GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set together',
      });
    }
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
