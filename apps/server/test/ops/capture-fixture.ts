// B8.3-local: capture a REAL provider message into the test/fixtures/headers/
// corpus (docs/13 §2).
//
// The offline classifier suites run against hand-written .eml fixtures — our
// best guess at what Gmail/Outlook actually send. This script replaces a guess
// with the real thing: it pulls raw RFC822 off IMAP and writes it as a fixture,
// so from then on the normal (offline, deterministic, no-network) suite is
// validating against wording a real provider produced. That conversion is what
// makes a manual canary pass permanent instead of disposable — most of B8.4.
//
//   npm run capture-fixture -w @coldemail/server -- --mailbox 1 --list
//   npm run capture-fixture -w @coldemail/server -- --mailbox 1 --uid 42 \
//     --name gmail-real-dsn-5xx [--dry-run]
//
// Reads are non-destructive (BODY.PEEK — \Seen is never set) and last_poll_uid
// is never touched, so capturing does not perturb a run in flight.
//
// PRIVACY: captured mail contains real addresses. Every address is rewritten to
// a corpus-consistent placeholder before anything is written, EXCEPT the
// provider/system identities the classifier legitimately matches on
// (mailer-daemon, postmaster, …). The mapping is printed — eyeball it before
// committing, and use --dry-run to see the file first.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ImapFlow } from 'imapflow';
import { loadConfig } from '../../src/config/env';
import { createDb } from '../../src/db/client';
import { DbMailboxConnectionProvider } from '../../src/services/mailboxConnections';
import type { MailboxConnection } from '../../src/transport/types';

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/headers');

/**
 * Addresses left verbatim: they identify a PROVIDER, not a person, and the
 * classifier keys off them (docs/07 §2). Scrubbing these would defeat the
 * point of capturing a real message.
 */
const PRESERVE = [
  /^mailer-daemon@/i,
  /^postmaster@/i,
  /^no-?reply@/i,
  /@mx\.google\.com>?$/i, // Message-ID host, not a mailbox
];

/** Matches bare addresses and the inside of <…> (Message-ID, From, Final-Recipient). */
const ADDRESS_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

interface Args {
  mailboxId: number;
  uid?: number;
  name?: string;
  list: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args | null {
  const value = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  const mailbox = value('--mailbox');
  if (mailbox === undefined) return null;
  const uid = value('--uid');
  const name = value('--name');
  return {
    mailboxId: Number(mailbox),
    ...(uid !== undefined && { uid: Number(uid) }),
    ...(name !== undefined && { name }),
    list: argv.includes('--list'),
    dryRun: argv.includes('--dry-run'),
  };
}

function usage(): void {
  console.error(
    'Usage:\n' +
      '  capture-fixture --mailbox <id> --list\n' +
      '  capture-fixture --mailbox <id> --uid <uid> --name <fixture-name> [--dry-run]',
  );
}

function imapClient(conn: MailboxConnection): ImapFlow {
  return new ImapFlow({
    host: conn.imapHost,
    port: conn.imapPort,
    secure: conn.imapPort === 993,
    auth: { user: conn.fromAddress, pass: conn.password },
    logger: false, // imapflow's default logger prints message content
    emitLogs: false,
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 30_000,
  });
}

/**
 * Rewrite every personal address to a stable placeholder consistent with the
 * existing corpus. Deterministic per run and order-independent: the same real
 * address always maps to the same placeholder within one capture.
 */
function scrub(raw: string, ownAddress: string): { text: string; map: Map<string, string> } {
  const map = new Map<string, string>();
  let leadCount = 0;

  const placeholderFor = (address: string): string => {
    const lower = address.toLowerCase();
    if (PRESERVE.some((re) => re.test(lower))) return address;
    const existing = map.get(lower);
    if (existing) return existing;
    // Our own sending mailbox → the corpus's operator address; everyone else is
    // a lead at the corpus's prospect domain.
    const placeholder =
      lower === ownAddress.toLowerCase()
        ? 'arjun@ourdomain.com'
        : `lead${String(++leadCount).padStart(2, '0')}@acmerealty.com`;
    map.set(lower, placeholder);
    return placeholder;
  };

  const text = raw.replace(ADDRESS_RE, (match) => placeholderFor(match));
  return { text, map };
}

async function listRecent(conn: MailboxConnection): Promise<void> {
  const client = imapClient(conn);
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const status = await client.status('INBOX', { messages: true, uidNext: true });
      const from = Math.max(1, (status.uidNext ?? 1) - 20);
      console.log(`INBOX: ${status.messages ?? 0} messages, uidNext ${status.uidNext ?? '?'}`);
      console.log('  uid  date                 from                           subject');
      for await (const m of client.fetch(
        { uid: `${from}:*` },
        { uid: true, envelope: true, internalDate: true },
        { uid: true },
      )) {
        const sender = m.envelope?.from?.[0]?.address ?? '(none)';
        const when = m.internalDate ? new Date(m.internalDate).toISOString().slice(0, 19) : '';
        const subject = m.envelope?.subject ?? '';
        console.log(
          `  ${String(m.uid).padStart(4)}  ${when}  ${sender.slice(0, 28).padEnd(30)} ${subject.slice(0, 60)}`,
        );
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}

async function fetchRaw(conn: MailboxConnection, uid: number): Promise<string> {
  const client = imapClient(conn);
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      // BODY.PEEK via `source` — does not set \Seen (docs/07 §1).
      const message = await client.fetchOne(
        String(uid),
        { uid: true, source: true },
        { uid: true },
      );
      if (!message || !message.source) throw new Error(`no message with uid ${uid} in INBOX`);
      return message.source.toString('utf8');
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  if (!args || Number.isNaN(args.mailboxId)) {
    usage();
    return 1;
  }
  if (!args.list && (args.uid === undefined || Number.isNaN(args.uid) || !args.name)) {
    usage();
    return 1;
  }

  const config = loadConfig();
  const { db, pool } = createDb(config.DATABASE_URL);
  try {
    const provider = new DbMailboxConnectionProvider({ db, secretKey: config.SECRET_KEY });
    const conn = await provider.load(args.mailboxId);
    if (!conn) {
      console.error(`mailbox ${args.mailboxId} not found, or has no stored credentials`);
      return 1;
    }

    if (args.list) {
      await listRecent(conn);
      return 0;
    }

    const raw = await fetchRaw(conn, args.uid!);
    const { text, map } = scrub(raw, conn.fromAddress);

    console.log(`Captured uid ${args.uid} (${raw.length} bytes). Address rewrites:`);
    if (map.size === 0) console.log('  (none — only provider identities present)');
    for (const [real, placeholder] of map) console.log(`  ${real}  →  ${placeholder}`);

    const remaining = text.match(ADDRESS_RE) ?? [];
    const leaked = remaining.filter((a) => !PRESERVE.some((re) => re.test(a.toLowerCase())));
    if (leaked.length > 0) {
      console.error(`\nREFUSING TO WRITE — unscrubbed addresses remain: ${leaked.join(', ')}`);
      return 1;
    }

    if (args.dryRun) {
      console.log(`\n--- ${args.name}.eml (dry run, not written) ---\n${text}`);
      return 0;
    }

    if (!existsSync(FIXTURES_DIR)) mkdirSync(FIXTURES_DIR, { recursive: true });
    const target = path.join(FIXTURES_DIR, `${args.name}.eml`);
    if (existsSync(target)) {
      const existing = readFileSync(target, 'utf8');
      if (existing !== text) {
        console.error(
          `\n${args.name}.eml already exists with different content. ` +
            'Delete it first if you mean to replace it.',
        );
        return 1;
      }
    }
    writeFileSync(target, text, 'utf8');
    console.log(`\nWrote ${target}`);
    console.log(
      'Next: add the name to FixtureName + ALL_FIXTURES in test/helpers/emlFixtures.ts, ' +
        'then assert its load-bearing fields in test/unit/header-fixtures.test.ts.',
    );
    return 0;
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('capture-fixture.ts')) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
