import { useState } from 'react';
import DOMPurify from 'dompurify';
import type { IncomingReviewMessage } from '@coldemail/shared';
import { Button } from '@/components/ui/button';

const TAGS = [
  'p',
  'br',
  'div',
  'span',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'ul',
  'ol',
  'li',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'a',
  'pre',
  'code',
  'hr',
];
export function sanitizeIncomingHtml(raw: string): { html: string; quoted: string } {
  const fragment = DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: TAGS,
    ALLOWED_ATTR: ['href', 'title', 'class', 'id'],
    RETURN_DOM_FRAGMENT: true,
  });
  const quotes = document.createElement('div');
  fragment
    .querySelectorAll('blockquote,.gmail_quote,.moz-cite-prefix,#divRplyFwdMsg,#appendonsend')
    .forEach((node) => {
      if (node.isConnected || fragment.contains(node)) quotes.appendChild(node);
    });
  const clean = (root: ParentNode) =>
    root.querySelectorAll('*').forEach((node) => {
      node.removeAttribute('class');
      node.removeAttribute('id');
      if (node.tagName === 'A') {
        const href = node.getAttribute('href') ?? '';
        if (!/^(https?:\/\/|mailto:)/i.test(href)) node.removeAttribute('href');
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
        node.setAttribute('referrerpolicy', 'no-referrer');
      }
    });
  clean(fragment);
  clean(quotes);
  const container = document.createElement('div');
  container.appendChild(fragment);
  return { html: container.innerHTML, quoted: quotes.innerHTML };
}
export function isolatedMessageDocument(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; frame-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; style-src 'unsafe-inline'"><style>body{font:16px/1.6 system-ui,sans-serif;color:#242424;margin:16px;overflow-wrap:anywhere}p{margin:0 0 1em}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #ddd;padding:6px}pre{white-space:pre-wrap}a{color:#31577c}blockquote{border-left:2px solid #ddd;margin:0;padding-left:12px}</style></head><body>${html}</body></html>`;
}
export function SafeMessage({ message }: { message: IncomingReviewMessage }) {
  const [format, setFormat] = useState<'text' | 'html'>('text');
  if (message.capture_status === 'deleted')
    return <p className="rounded-md bg-muted p-4 text-sm">Stored content deleted</p>;
  if (message.capture_status === 'oversized')
    return (
      <p className="rounded-md bg-muted p-4 text-sm">
        Content exceeds the 5 MiB capture limit. Open the original email in your mailbox.
      </p>
    );
  if (message.capture_status === 'unavailable')
    return (
      <p className="rounded-md bg-muted p-4 text-sm">
        Full content unavailable. Open the original email in your mailbox.
      </p>
    );
  const sanitized = message.body_html ? sanitizeIncomingHtml(message.body_html) : null;
  return (
    <div className="space-y-4">
      {message.capture_status === 'legacy_preview' && (
        <p className="text-sm text-muted-foreground">
          Legacy preview only — full content was not captured.
        </p>
      )}
      {sanitized && (
        <div className="flex gap-1" role="group" aria-label="Message format">
          <Button
            size="sm"
            variant={format === 'text' ? 'secondary' : 'ghost'}
            onClick={() => setFormat('text')}
          >
            Text
          </Button>
          <Button
            size="sm"
            variant={format === 'html' ? 'secondary' : 'ghost'}
            onClick={() => setFormat('html')}
          >
            HTML
          </Button>
        </div>
      )}
      {format === 'html' && sanitized ? (
        <iframe
          title="Email HTML content"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          srcDoc={isolatedMessageDocument(sanitized.html)}
          className="h-[min(60vh,36rem)] w-full rounded-md border bg-white"
        />
      ) : (
        <div className="whitespace-pre-wrap break-words text-base leading-relaxed">
          {message.new_text ?? message.body_text ?? message.snippet ?? 'No readable text captured.'}
        </div>
      )}
      {(format === 'html' ? sanitized?.quoted : message.quoted_text) && (
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer text-sm text-muted-foreground">Quoted history</summary>
          {format === 'html' && sanitized ? (
            <iframe
              title="Quoted email HTML"
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
              srcDoc={isolatedMessageDocument(sanitized.quoted)}
              className="mt-3 h-80 w-full bg-white"
            />
          ) : (
            <div className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
              {message.quoted_text}
            </div>
          )}
        </details>
      )}
      <p className="text-xs text-muted-foreground">
        Remote images, tracking and attachments are disabled.
      </p>
    </div>
  );
}
