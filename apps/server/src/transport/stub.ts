import type {
  IncomingMessage,
  MailTransport,
  MailboxVerifyConfig,
  OutboundMessage,
  SendResult,
  VerifyResult,
} from './types';

/**
 * Placeholder wired by composition.ts until a real implementation exists
 * (MockTransport in B3, SmtpImapTransport in B8). Throws on any use so a
 * mis-wired composition fails loudly, never silently.
 */
export class NotImplementedTransport implements MailTransport {
  constructor(private readonly hint: string) {}

  send(_msg: OutboundMessage): Promise<SendResult> {
    return Promise.reject(new Error(`MailTransport.send not available: ${this.hint}`));
  }

  fetchNew(_mailboxId: number): Promise<IncomingMessage[]> {
    return Promise.reject(new Error(`MailTransport.fetchNew not available: ${this.hint}`));
  }

  verify(_config: MailboxVerifyConfig): Promise<VerifyResult> {
    return Promise.reject(new Error(`MailTransport.verify not available: ${this.hint}`));
  }
}
