// The B5.8 fixture generator (docs/09 §7): 1,000 CSV rows reproducing the
// exact walkthrough split — 60 role-based + 40 invalid + 15 in-file
// duplicates → 885 committable, 82 of them missing first_name, 0 suppressed.
// Deterministic (seeded shuffle); write.ts persists real_estate_leads.csv and
// the split test locks generator ⇔ committed file.
import { seededRng } from '../../../src/util/rng';
import { ROLE_LOCAL_PARTS } from '../../../src/ingest/hygiene';

export const SPLIT = {
  total: 1000,
  committable: 885, // "Import 885"
  missingFirstName: 82, // among the 885
  roleBased: 60,
  invalid: 40,
  duplicate: 15,
  suppressed: 0,
} as const;

const FIRST = ['James', 'Maria', 'Wei', 'Aisha', 'Carlos', 'Emma', 'Raj', 'Sofia', 'Liam', 'Nina'];
const LAST = [
  'Chen',
  'Garcia',
  'Patel',
  'Kim',
  'Okafor',
  'Novak',
  'Silva',
  'Haddad',
  'Ross',
  'Baker',
];
const CITIES: Array<[string, string]> = [
  ['Austin', 'TX'],
  ['Dallas', 'TX'],
  ['Phoenix', 'AZ'],
  ['Denver', 'CO'],
  ['Atlanta', 'GA'],
  ['Tampa', 'FL'],
  ['Columbus', 'OH'],
  ['Portland', 'OR'],
];

interface FixtureRow {
  email: string;
  first_name: string;
  last_name: string;
  company: string;
  city: string;
  state: string;
}

function cleanRow(i: number, missingName: boolean): FixtureRow {
  const domain = `brokerage${i % 25}.com`;
  const [city, state] = CITIES[i % CITIES.length]!;
  return {
    email: `agent${i}@${domain}`,
    first_name: missingName ? '' : FIRST[i % FIRST.length]!,
    last_name: LAST[(i * 7) % LAST.length]!,
    company: `Brokerage ${i % 25} Realty`,
    city,
    state,
  };
}

export function generateFixtureRows(): FixtureRow[] {
  // 885 committable — first_name missing on a fixed cadence, exactly 82 times.
  const clean: FixtureRow[] = [];
  let missing = 0;
  for (let i = 0; i < SPLIT.committable; i++) {
    const missName = i % 10 === 7 && missing < SPLIT.missingFirstName;
    if (missName) missing += 1;
    clean.push(cleanRow(i, missName));
  }

  const roles = [...ROLE_LOCAL_PARTS];
  const role: FixtureRow[] = Array.from({ length: SPLIT.roleBased }, (_, i) => ({
    ...cleanRow(2000 + i, false),
    email: `${roles[i % roles.length]}@office${i}.com`,
  }));

  const invalidEmail = (i: number): string =>
    [
      `agent${i}ATnowhere.com`, // no @
      `agent${i}@@double.com`, // two @
      `agent ${i}@spaced.com`, // whitespace
      `agent${i}@nodotcom`, // no dot in domain
      `agent${i}@tld.x`, // 1-char TLD
    ][i % 5]!;
  const invalid: FixtureRow[] = Array.from({ length: SPLIT.invalid }, (_, i) => ({
    ...cleanRow(3000 + i, false),
    email: invalidEmail(i),
  }));

  // In-file duplicates of the first 15 clean rows (which are pinned to the
  // head of the file, so "first occurrence kept" is well-defined).
  const dup: FixtureRow[] = Array.from({ length: SPLIT.duplicate }, (_, i) => ({
    ...clean[i]!,
    first_name: 'Dupe',
  }));

  // Order: clean[0..14] first (dup originals), then a seeded shuffle of the
  // rest + role + invalid, duplicates in the tail.
  const pool = [...clean.slice(15), ...role, ...invalid];
  const rng = seededRng(2026);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return [...clean.slice(0, 15), ...pool, ...dup];
}

export function generateFixtureCsv(): string {
  const header = 'email,first_name,last_name,company,city,state';
  const lines = generateFixtureRows().map(
    (r) => `${r.email},${r.first_name},${r.last_name},${r.company},${r.city},${r.state}`,
  );
  return `${header}\n${lines.join('\n')}\n`;
}
