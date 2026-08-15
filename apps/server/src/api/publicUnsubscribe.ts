// Public one-click / link unsubscribe (docs/16 §8, 0010).
//
// This is the ONLY unauthenticated write surface in the product, so its rules
// are deliberately narrow and stated here rather than inferred:
//
//  * It is registered OUTSIDE the /api/v1 scope (like /health), so it inherits
//    neither the session plugin nor the CSRF-header check. Gmail's one-click
//    POST carries no cookie and no custom header — requiring either would make
//    the button silently fail.
//  * GET renders a confirmation page and NEVER unsubscribes. Security scanners
//    and privacy proxies prefetch links; a GET that acted would opt people out
//    who never clicked.
//  * An unknown token renders the SAME generic page as a known one. Telling a
//    caller which tokens exist would turn this into an enumeration oracle.
//  * Nothing here logs the token, the email, or the lead id.
//  * Redeeming is idempotent: a second POST (or a lead already unsubscribed by
//    a STOP reply) succeeds without appending a duplicate fact.
import type { FastifyInstance } from 'fastify';
import type { AppServices } from '../composition';
import { markUsed, resolveToken } from '../db/repos/unsubscribeTokensRepo';
import { getById as getEnrollmentById } from '../db/repos/enrollmentsRepo';
import { buildEvent } from '../domain/events';

/** No external CSS/JS: this page must render inside any mail-client browser. */
function page(heading: string, body: string, form?: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${heading}</title>
<style>
 body{font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;margin:0;padding:3rem 1.25rem;
      color:#1a1a1a;background:#fafafa;display:flex;justify-content:center}
 main{max-width:26rem;background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:1.75rem}
 h1{font-size:1.15rem;margin:0 0 .75rem}
 p{margin:0 0 1rem;color:#444}
 button{font:inherit;background:#1a1a1a;color:#fff;border:0;border-radius:6px;
        padding:.6rem 1.1rem;cursor:pointer}
</style></head>
<body><main><h1>${heading}</h1><p>${body}</p>${form ?? ''}</main></body></html>`;
}

const CONFIRM_BODY =
  'Confirm and you will not receive any further emails from us. ' +
  'This applies to every campaign, not just the message you clicked from.';

const DONE = page('You are unsubscribed', 'You will not receive further emails from us.');

/**
 * Deliberately identical wording to the success page for an unknown token: a
 * recipient who clicks an expired link should be reassured, not told the token
 * is invalid, and an attacker learns nothing either way.
 */
const GENERIC = DONE;

export async function publicUnsubscribeRoutes(
  app: FastifyInstance,
  services: AppServices,
): Promise<void> {
  const { db, store, clock } = services;

  // Gmail's one-click POST sends `List-Unsubscribe=One-Click` as
  // application/x-www-form-urlencoded. Fastify registers no parser for that
  // type by default, so without this the button 500s in production — which is
  // invisible to us, because the failure happens at Google. We never read the
  // body (the token is in the path), so it is accepted and discarded.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, _body, done) => done(null, {}),
  );

  app.get<{ Params: { token: string } }>('/u/:token', async (req, reply) => {
    const found = await resolveToken(db, req.params.token);
    if (!found) return reply.type('text/html; charset=utf-8').send(GENERIC);
    // The token round-trips through the form so the POST needs no session.
    const action = `/u/${encodeURIComponent(req.params.token)}`;
    return reply
      .type('text/html; charset=utf-8')
      .send(
        page(
          'Unsubscribe',
          CONFIRM_BODY,
          `<form method="post" action="${action}"><button type="submit">Unsubscribe me</button></form>`,
        ),
      );
  });

  app.post<{ Params: { token: string } }>('/u/:token', async (req, reply) => {
    const html = (body: string) => reply.type('text/html; charset=utf-8').send(body);
    const found = await resolveToken(db, req.params.token);
    if (!found) return html(GENERIC);

    const now = clock.now();
    const enrollment = await getEnrollmentById(db, found.enrollmentId);

    // Already terminal by unsubscribe (this token used, or a STOP reply got
    // here first) — succeed without appending a second fact to the ledger.
    if (enrollment?.currentState !== 'UNSUBSCRIBED') {
      await store.append([
        buildEvent.unsubscribe({
          leadId: found.leadId,
          enrollmentId: found.enrollmentId,
          campaignId: found.campaignId,
          occurredAt: now,
          source: 'link',
        }),
      ]);
    }
    await markUsed(db, found.id, now);
    return html(DONE);
  });
}
