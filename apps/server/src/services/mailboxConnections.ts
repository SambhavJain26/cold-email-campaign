// B8.1: the DB side of the MailboxConnectionProvider port. SmtpImapTransport is
// handed a mailboxId only and may not touch the DB (docs/02 §1), so this service
// reads the `mailboxes` row, unseals the password just-in-time (never cached,
// never logged) and hands over the UID high-water mark the IMAP fetch needs.
import type { Db } from '../db/client';
import type {
  MailboxConnection,
  MailboxConnectionProvider,
  OAuthAccessTokenProvider,
} from '../transport/types';
import { getMailbox, getMailboxSecret } from '../db/repos/mailboxesRepo';
import { listCursors } from '../db/repos/pollCursorsRepo';
import { unsealSecret } from '../secrets/seal';

export interface MailboxConnectionDeps {
  db: Db;
  /** SECRET_KEY — the libsodium sealing key (docs/16 §1). */
  secretKey: string;
  oauth?: OAuthAccessTokenProvider;
}

export class DbMailboxConnectionProvider implements MailboxConnectionProvider {
  constructor(private readonly deps: MailboxConnectionDeps) {}

  async load(mailboxId: number): Promise<MailboxConnection | null> {
    const { db, secretKey } = this.deps;
    const row = await getMailbox(db, mailboxId);
    if (!row) return null;
    let auth: Pick<MailboxConnection, 'authType' | 'password' | 'accessToken'>;
    if (row.authType === 'google_oauth') {
      if (!this.deps.oauth) return null;
      auth = {
        authType: 'google_oauth',
        accessToken: await this.deps.oauth.accessToken(mailboxId),
      };
    } else {
      const sealed = await getMailboxSecret(db, mailboxId);
      if (!sealed) return null;
      auth = { authType: 'app_password', password: await unsealSecret(sealed, secretKey) };
    }

    return {
      displayName: row.displayName,
      fromAddress: row.fromAddress,
      smtpHost: row.smtpHost,
      smtpPort: row.smtpPort,
      imapHost: row.imapHost,
      imapPort: row.imapPort,
      ...auth,
      folders: await this.foldersFor(mailboxId, row.pollFolders),
    };
  }

  /**
   * Pair each configured folder with its own cursor (0012). A folder with no
   * cursor row yet reports 0, which the poller seeds from UIDNEXT before
   * fetching — otherwise adding Spam would ingest that folder's entire history
   * (finding 16 applies per folder, not per mailbox).
   */
  private async foldersFor(
    mailboxId: number,
    configured: string[],
  ): Promise<{ name: string; lastPollUid: number }[]> {
    const cursors = new Map(
      (await listCursors(this.deps.db, mailboxId)).map((c) => [c.folder, c.lastPollUid]),
    );
    const names = configured.length > 0 ? configured : ['INBOX'];
    return names.map((name) => ({ name, lastPollUid: cursors.get(name) ?? 0 }));
  }
}
