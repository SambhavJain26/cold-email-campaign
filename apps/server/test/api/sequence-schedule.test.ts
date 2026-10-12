import { randomUUID, createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiHarness, type ApiHarness } from './helpers/app';
import { seedMailboxes } from '../helpers/db';
import { buildEvent } from '../../src/domain/events';
import { rebuildProjections } from '../../src/services/rebuildProjections';
import { migrateDown, migrateUp } from '../../src/db/migrate';
import { MIGRATIONS_DIR } from '../helpers/db';
import type { SchedulePreview } from '@coldemail/shared';
import { reviewActionSchema } from '@coldemail/shared';
import { applyReviewAction } from '../../src/services/incomingReviewActions';
import { loadSequenceDef } from '../../src/db/repos/sequencesRepo';

const proposal = {
  wait_day_mode: 'business_days',
  steps: [0, 3, 14, 4, 4].map((wait_days, i) => ({
    step_no: i + 1,
    wait_days,
    in_thread: i !== 0 && i !== 2,
  })),
};
describe('schedule preview/apply', () => {
  let h: ApiHarness;
  beforeAll(async () => {
    h = await createApiHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await h.reset();
    h.clock.set(new Date('2026-10-12T12:00:00Z'));
    await seedMailboxes(h.pool, 1);
    await h.pool.query("UPDATE mailboxes SET timezone='America/New_York' WHERE id=1");
    await h.pool.query("INSERT INTO sequences(name) VALUES('Five emails')");
    await h.pool.query(
      'INSERT INTO sequence_steps(sequence_id,step_no,wait_days,in_thread) VALUES(1,1,0,false),(1,2,3,true),(1,3,4,false),(1,4,4,true),(1,5,5,true)',
    );
    await h.pool.query(
      "INSERT INTO step_variants(step_id,label,subject_template,body_template,content_hash) SELECT id,'A','Hello','Saved content','hash' FROM sequence_steps",
    );
    await h.pool.query(
      "INSERT INTO campaigns(name,status,sequence_id) VALUES('Current campaign','paused',1)",
    );
    for (let id = 1; id <= 4; id++) {
      await h.pool.query("INSERT INTO leads(email,tier) VALUES($1,'B')", [
        `schedule${id}@example.test`,
      ]);
      await h.pool.query(
        "INSERT INTO enrollments(lead_id,campaign_id,personalization_mode,enrolled_at) VALUES($1,1,'template_auto','2026-10-06')",
        [id],
      );
      const ids = {
        leadId: id,
        campaignId: 1,
        enrollmentId: id,
        occurredAt: new Date('2026-10-06T18:00:00Z'),
      };
      await h.services.store.append([buildEvent.enrolled(ids)], {
        patches: [{ enrollmentId: id, nextSendAt: ids.occurredAt, assignedMailboxId: 1 }],
      });
      if (id === 4) continue; // opener
      await h.services.store.append(
        [
          buildEvent.sent({
            ...ids,
            stepNo: 1,
            mailboxId: 1,
            messageId: `<schedule${id}>`,
            attributes: { content_hash: 'hash', variant_id: 1 },
          }),
        ],
        { patches: [{ enrollmentId: id, nextSendAt: new Date('2026-10-09T18:00:00Z') }] },
      );
      await h.pool.query(
        "INSERT INTO sent_messages(message_id,enrollment_id,lead_id,mailbox_id,step_no,content_hash,rendered_subject,rendered_body_text,email_format,sent_at,conversation_root_id) VALUES($1,$2,$2,1,1,'hash','Hello','Saved content','plain_text','2026-10-06T18:00:00Z',$1)",
        [`<schedule${id}>`, id],
      );
      if (id === 2) {
        await h.services.store.append([
          buildEvent.reviewRequired({
            ...ids,
            occurredAt: new Date('2026-10-07'),
            attributes: { incoming_message_id: 999 },
          }),
        ]);
        // Delays are ledger-derived; append a review decision rather than edit a projection.
        const hold = (await h.pool.query('SELECT review_hold_ids FROM enrollments WHERE id=2'))
          .rows[0].review_hold_ids;
        await h.services.store.append([
          buildEvent.reviewDecided({
            ...ids,
            occurredAt: new Date('2026-10-08'),
            attributes: {
              action: 'delay',
              hold_event_ids: [],
              until: '2026-10-20T12:00:00.000Z',
              operation_id: randomUUID(),
            },
          }),
        ]);
        expect(hold).toHaveLength(1);
      }
      if (id === 3)
        await h.services.store.append(
          [
            buildEvent.softBounce({
              ...ids,
              occurredAt: new Date('2026-10-07'),
              stepNo: 1,
              attributes: { retry_no: 1 },
            }),
          ],
          { patches: [{ enrollmentId: id, nextSendAt: new Date('2026-10-07T04:00:00Z') }] },
        );
    }
  });
  const preview = async () => {
    const res = await h.inject({
      method: 'POST',
      url: '/api/v1/sequences/1/schedule/preview',
      payload: proposal,
    });
    expect(res.statusCode).toBe(200);
    return res.json<SchedulePreview>();
  };
  const apply = (p: SchedulePreview, operation_id = randomUUID()) =>
    h.inject({
      method: 'POST',
      url: '/api/v1/sequences/1/schedule/apply',
      payload: { ...proposal, fingerprint: p.fingerprint, operation_id },
    });

  it('previews and atomically applies dates, preserving holds/delays/retries/history and replay', async () => {
    const before = (await h.pool.query('SELECT * FROM enrollments ORDER BY id')).rows;
    const sends = (await h.pool.query('SELECT * FROM sent_messages ORDER BY message_id')).rows;
    const p = await preview();
    expect(p.can_apply).toBe(true);
    expect(p.rows[0]).toMatchObject({
      lead_id: 1,
      lead_email: 'schedule1@example.test',
      lead_name: 'schedule1@example.test',
    });
    expect(p.rows[0]!.new_due_at).toBe('2026-10-09T04:00:00.000Z');
    expect(p.rows[1]).toMatchObject({ held: true, effective_due_at: '2026-10-20T12:00:00.000Z' });
    expect(p.rows[2]!.exclusion).toContain('retry');
    expect(p.rows[3]!.exclusion).toContain('first email');
    const operation = randomUUID();
    const res = await apply(p, operation);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().changed).toBe(2);
    expect((await apply(p, operation)).statusCode).toBe(200);
    expect(
      Number(
        (await h.pool.query("SELECT count(*) FROM events WHERE type='schedule_recalculated'"))
          .rows[0].count,
      ),
    ).toBe(2);
    const after = (await h.pool.query('SELECT * FROM enrollments ORDER BY id')).rows;
    for (let i = 0; i < 4; i++) {
      const { next_send_at: _before, ...old } = before[i];
      const { next_send_at: _after, ...fresh } = after[i];
      expect(fresh).toEqual(old);
      if (i >= 2) expect(after[i].next_send_at).toEqual(before[i].next_send_at);
    }
    expect((await h.pool.query('SELECT * FROM sent_messages ORDER BY message_id')).rows).toEqual(
      sends,
    );
    expect(
      (
        await rebuildProjections(h.services.db, {
          dryRun: true,
          shapeFor: () => ({ lastStepNo: 5, softRetryMax: 3, stopOnReply: true }),
          deliveryConfirmMs: 86400000,
          now: h.clock.now(),
        })
      ).diffs,
    ).toEqual([]);
  });
  it('rejects stale previews and active shared campaigns without partial changes', async () => {
    const p = await preview();
    await h.pool.query("UPDATE enrollments SET snoozed_until='2026-10-25' WHERE id=1");
    expect((await apply(p)).statusCode).toBe(409);
    await h.pool.query(
      "INSERT INTO campaigns(name,status,sequence_id) VALUES('Shared active','active',1)",
    );
    const blocked = await preview();
    expect(blocked.campaigns).toHaveLength(2);
    expect(blocked.can_apply).toBe(false);
    expect((await apply(blocked)).statusCode).toBe(409);
    expect(
      (await h.pool.query('SELECT wait_day_mode FROM sequences WHERE id=1')).rows[0].wait_day_mode,
    ).toBe('elapsed_days');
  });
  it('blocks missing accepted-message evidence; rejects duplicate steps', async () => {
    await h.pool.query("DELETE FROM sent_messages WHERE message_id='<schedule1>'");
    const p = await preview();
    expect(p.can_apply).toBe(false);
    expect((await apply(p)).statusCode).toBe(409);
    const bad = await h.inject({
      method: 'POST',
      url: '/api/v1/sequences/1/schedule/preview',
      payload: { ...proposal, steps: [proposal.steps[0], proposal.steps[0]] },
    });
    expect(bad.json().can_apply).toBe(false);
  });
  it('normal saves preserve omitted mode and do not recalculate existing dates', async () => {
    const original = (await h.pool.query('SELECT next_send_at FROM enrollments ORDER BY id')).rows;
    const sequence = (await h.inject({ method: 'GET', url: '/api/v1/sequences' })).json().items[0];
    const { wait_day_mode: _mode, ...body } = sequence;
    expect(
      (
        await h.inject({
          method: 'PATCH',
          url: '/api/v1/sequences/1',
          payload: { ...body, wait_day_mode: 'business_days' },
        })
      ).statusCode,
    ).toBe(200);
    const saved = await h.inject({ method: 'PATCH', url: '/api/v1/sequences/1', payload: body });
    expect(saved.json().wait_day_mode).toBe('business_days');
    expect((await h.pool.query('SELECT next_send_at FROM enrollments ORDER BY id')).rows).toEqual(
      original,
    );
  });
  it('preserves policy, facts and receipts through migration down/apply', async () => {
    const p = await preview();
    expect((await apply(p)).statusCode).toBe(200);
    await migrateDown(h.pool, MIGRATIONS_DIR, 1);
    await migrateUp(h.pool, MIGRATIONS_DIR);
    expect(
      (await h.pool.query('SELECT wait_day_mode FROM sequences WHERE id=1')).rows[0].wait_day_mode,
    ).toBe('business_days');
    expect(
      Number(
        (await h.pool.query('SELECT count(*) FROM sequence_schedule_operations')).rows[0].count,
      ),
    ).toBe(1);
  });
  it('poll freshness does not stale a preview; concurrent duplicate applies have one receipt', async () => {
    const p = await preview();
    await h.pool.query('UPDATE mailboxes SET last_successful_poll_at=now() WHERE id=1');
    const id = randomUUID();
    const results = await Promise.all([apply(p, id), apply(p, id)]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(
      Number(
        (await h.pool.query('SELECT count(*) FROM sequence_schedule_operations')).rows[0].count,
      ),
    ).toBe(1);
    expect(
      (
        await h.inject({
          method: 'POST',
          url: '/api/v1/sequences/1/schedule/apply',
          payload: {
            ...proposal,
            steps: proposal.steps.map((s) => ({
              ...s,
              wait_days: s.step_no === 2 ? 4 : s.wait_days,
            })),
            fingerprint: p.fingerprint,
            operation_id: id,
          },
        })
      ).statusCode,
    ).toBe(409);
  });
  it('accepted retries anchor the next date to the retry and verify the exact snapshot', async () => {
    const at = new Date('2026-10-08T18:00:00Z');
    await h.services.store.append(
      [
        buildEvent.sent({
          leadId: 3,
          enrollmentId: 3,
          campaignId: 1,
          occurredAt: at,
          stepNo: 1,
          mailboxId: 1,
          messageId: '<accepted-retry>',
          attributes: { content_hash: 'hash', variant_id: 1, retry_no: 1 },
        }),
      ],
      { patches: [{ enrollmentId: 3, nextSendAt: new Date('2026-10-11T18:00:00Z') }] },
    );
    await h.pool.query(
      "INSERT INTO sent_messages(message_id,enrollment_id,lead_id,mailbox_id,step_no,content_hash,rendered_subject,rendered_body_text,email_format,sent_at,conversation_root_id) VALUES('<accepted-retry>',3,3,1,1,'hash','Hello','Saved content','plain_text',$1,'<schedule3>')",
      [at],
    );
    const p = await preview();
    expect(p.rows[2]).toMatchObject({ exclusion: null, new_due_at: '2026-10-13T04:00:00.000Z' });
    expect((await apply(p)).json().changed).toBe(3);
  });
  it('preview/apply require authentication and terminal enrollments remain excluded', async () => {
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/v1/sequences/1/schedule/preview',
          headers: { 'x-requested-with': 'fetch' },
          payload: proposal,
        })
      ).statusCode,
    ).toBe(401);
    await h.services.store.append([
      buildEvent.hardBounce({
        leadId: 1,
        enrollmentId: 1,
        campaignId: 1,
        occurredAt: h.clock.now(),
        stepNo: 1,
      }),
    ]);
    const p = await preview();
    expect(p.rows[0]!.exclusion).toContain('Terminal');
    expect((await apply(p)).json().changed).toBe(1);
    expect(
      (await h.pool.query('SELECT next_send_at FROM enrollments WHERE id=1')).rows[0].next_send_at,
    ).toBeNull();
  });
  it('legacy restoration fallback uses business days while explicit checkpoints stay exact', async () => {
    await h.pool.query("UPDATE sequences SET wait_day_mode='business_days' WHERE id=1");
    const [reply] = await h.services.store.append([
      buildEvent.humanReply({
        leadId: 1,
        enrollmentId: 1,
        campaignId: 1,
        occurredAt: h.clock.now(),
        sentiment: 'neutral',
      }),
    ]);
    await applyReviewAction(
      h.services.db,
      h.services.store,
      1,
      reviewActionSchema.parse({
        action: 'restore_legacy',
        expected_revision: reply,
        operation_id: randomUUID(),
      }),
      h.clock.now(),
    );
    const restored = (await h.pool.query('SELECT * FROM enrollments WHERE id=1')).rows[0];
    expect(restored.next_send_at.toISOString()).toBe('2026-10-09T04:00:00.000Z');
    expect(restored.review_hold_ids).toHaveLength(1);
    const seq = await loadSequenceDef(h.services.db, 1);
    const checkpoint = '2026-10-25T18:20:51.546Z';
    const [stop] = await h.services.store.append([
      buildEvent.sequenceStopped({
        leadId: 1,
        enrollmentId: 1,
        campaignId: 1,
        occurredAt: h.clock.now(),
        attributes: {
          hold_event_ids: [],
          resume_due_at: checkpoint,
          sequence_fingerprint: createHash('sha256').update(JSON.stringify(seq)).digest('hex'),
          operation_id: randomUUID(),
        },
      }),
    ]);
    await applyReviewAction(
      h.services.db,
      h.services.store,
      1,
      reviewActionSchema.parse({
        action: 'correct_stop',
        expected_revision: stop,
        operation_id: randomUUID(),
      }),
      h.clock.now(),
    );
    expect(
      (
        await h.pool.query('SELECT next_send_at FROM enrollments WHERE id=1')
      ).rows[0].next_send_at.toISOString(),
    ).toBe(checkpoint);
  });
  it('zero-enrollment schedule applies retain an immutable receipt and prevent sequence deletion', async () => {
    const created = await h.inject({
      method: 'POST',
      url: '/api/v1/sequences',
      payload: {
        name: 'Receipt-only sequence',
        steps: [0, 3].map((wait_days, i) => ({
          step_no: i + 1,
          wait_days,
          in_thread: i > 0,
          variants: [{ label: 'A', subject_template: 'Hello', body_template: 'Saved body' }],
        })),
      },
    });
    const id = created.json().id;
    const timing = { ...proposal, steps: proposal.steps.slice(0, 2) };
    const p = (
      await h.inject({
        method: 'POST',
        url: `/api/v1/sequences/${id}/schedule/preview`,
        payload: timing,
      })
    ).json();
    const body = { ...timing, fingerprint: p.fingerprint, operation_id: randomUUID() };
    const apply = () =>
      h.inject({ method: 'POST', url: `/api/v1/sequences/${id}/schedule/apply`, payload: body });
    expect((await apply()).json().changed).toBe(0);
    expect((await apply()).statusCode).toBe(200);
    expect(
      (
        await h.inject({
          method: 'DELETE',
          url: `/api/v1/sequences/${id}`,
          payload: { confirm: 'Receipt-only sequence' },
        })
      ).statusCode,
    ).toBe(409);
  });
});
