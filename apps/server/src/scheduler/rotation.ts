// Opener rotation (docs/06 §3): among ok mailboxes with budget, pick lowest
// sentToday/capToday ratio; tie → least-recent last_send_at; still tied
// (e.g. fresh mailboxes) → seeded rng pick, so tests are deterministic.
import type { Rng } from '../util/rng';

export interface RotationCandidate {
  id: number;
  sentToday: number;
  capToday: number;
  budget: number;
  lastSendAt: Date | null;
}

export function pickMailbox(
  candidates: readonly RotationCandidate[],
  rng: Rng,
): RotationCandidate | null {
  const eligible = candidates.filter((c) => c.budget > 0 && c.capToday > 0);
  if (eligible.length === 0) return null;

  const ratio = (c: RotationCandidate) => c.sentToday / c.capToday;
  const minRatio = Math.min(...eligible.map(ratio));
  let pool = eligible.filter((c) => ratio(c) === minRatio);

  if (pool.length > 1) {
    // least-recent send first; never-sent (null) is "least recent" of all
    const key = (c: RotationCandidate) => c.lastSendAt?.getTime() ?? -1;
    const minKey = Math.min(...pool.map(key));
    pool = pool.filter((c) => key(c) === minKey);
  }

  return pool.length === 1 ? pool[0]! : pool[Math.floor(rng() * pool.length)]!;
}
