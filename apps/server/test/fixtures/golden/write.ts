// Writes the committed events.jsonl. Run: npx tsx test/fixtures/golden/write.ts
// The fixture is reviewed-in - never regenerated silently (docs/13 §2); the
// golden determinism test fails if generator and file ever diverge.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGoldenEvents, serializeGoldenEvents } from './generate';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'events.jsonl');
const events = buildGoldenEvents();
writeFileSync(out, serializeGoldenEvents(events));
console.log(`wrote ${events.length} events to ${out}`);
