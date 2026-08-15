// Drive the canary on demand (docs/17 §§3–6), instead of waiting on crons.
//
// The scheduler ticks every 5 minutes, IMAP polls every 5, and confirm-delivery
// is a DELAYED job. During an accelerated validation run that is 15+ minutes of
// dead time per lead, so this exposes each step as a command.
//
// WHY IT STARTS `Jobs`: the 2026-08-14 gate learned this the expensive way. A
// standalone script appended a `sent` event with no pg-boss running, so the
// delayed confirm-delivery job was silently never scheduled and the missing job
// had to be restored by hand. Any one-off that appends a send MUST start Jobs.
//
//   npx tsx test/ops/canary-drive.ts tick
//   npx tsx test/ops/canary-drive.ts poll [mailboxId]        # all if omitted
//   npx tsx test/ops/canary-drive.ts confirm-now             # due the delayed jobs
//   npx tsx test/ops/canary-drive.ts status
//
// Read-only apart from what the scheduler/poller themselves append. It changes
// no settings — that is deliberate, so this file is safe to leave in the repo.
import { loadConfig } from '../../src/config/env';
import { compose } from '../../src/composition';
import { listMailboxes } from '../../src/db/repos/mailboxesRepo';
import { runSelfCheckJob } from '../../src/jobs/integrity';
import { DbAlertSink } from '../../src/alerts/emitter';

/**
 * pg-boss holds delayed jobs with `startafter` in the future. Pulling that
 * forward is how the Aug 14 gate advanced its confirm windows; the running
 * worker then picks them up on its next fetch. Far cheaper than waiting out
 * `delivery_confirm_hours`, and it exercises the REAL job path rather than
 * calling runConfirmDelivery directly.
 */
const DUE_NOW_SQL = `
  UPDATE pgboss.job
     SET start_after = now()
   WHERE name = 'confirm-delivery'
     AND state = 'created'
     AND start_after > now()
  RETURNING id`;

async function main(): Promise<void> {
  const [command, arg] = process.argv.slice(2);
  const config = loadConfig();
  const services = compose(config, {});

  // Started for every command: `tick` sends, and a send with no Jobs running
  // loses its confirm-delivery job. Cheap enough that gating it would only
  // create a footgun.
  await services.jobs.start();

  try {
    switch (command) {
      case 'tick': {
        const result = await services.scheduler.tick();
        console.log(JSON.stringify(result));
        if (services.scheduler.sendBlockers.length > 0) {
          console.log('BLOCKERS:', JSON.stringify(services.scheduler.sendBlockers));
        }
        break;
      }
      case 'poll': {
        const ids = arg
          ? [Number(arg)]
          : (await listMailboxes(services.db)).map((m) => m.id).sort((a, b) => a - b);
        for (const id of ids) {
          console.log(id, JSON.stringify(await services.poller.poll(id)));
        }
        break;
      }
      case 'confirm-now': {
        const res = await services.pool.query(DUE_NOW_SQL);
        console.log(`advanced ${res.rowCount ?? 0} confirm-delivery job(s) to run now`);
        // Give the running worker a moment to pick them up before we exit.
        await new Promise((r) => setTimeout(r, 8_000));
        break;
      }
      case 'self-check': {
        // The DAILY job, not the shape-independent CLI: only this path runs
        // the backup-freshness probe alongside the invariants (docs/16 §4).
        const result = await runSelfCheckJob({
          db: services.db,
          // Alerts are not on AppServices, so build the same sink composition
          // builds — without the webhook, which a manual run should not fire.
          alerts: new DbAlertSink(services.db),
          ...(config.BACKUP_DIR !== undefined && { backupDir: config.BACKUP_DIR }),
          now: () => services.clock.now(),
        });
        console.log(
          JSON.stringify({
            violations: result.violations.length,
            backupStale: result.backupStale,
          }),
        );
        break;
      }
      case 'status': {
        const boxes = await listMailboxes(services.db);
        for (const m of boxes) {
          console.log(
            `mailbox ${m.id} ${m.fromAddress} status=${m.status} cap=${m.dailyCap} lastPoll=${m.lastSuccessfulPollAt?.toISOString() ?? 'never'}`,
          );
        }
        console.log('lastTickAt', services.scheduler.lastTickAt?.toISOString() ?? 'never');
        break;
      }
      default:
        console.error(
          'usage: canary-drive.ts tick | poll [mailboxId] | confirm-now | self-check | status',
        );
        process.exitCode = 1;
    }
  } finally {
    await services.jobs.stop();
    await services.transport.close?.();
    await services.pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
