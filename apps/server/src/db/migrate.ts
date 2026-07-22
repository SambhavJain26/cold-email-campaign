// Minimal SQL migration runner (docs/03 §6): migrations are paired
// NNNN_name.up.sql / NNNN_name.down.sql files, applied in filename order,
// tracked in schema_migrations. drizzle-kit is used only to help GENERATE
// SQL from schema diffs — this runner is what executes migrations.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';

export interface Migration {
  name: string;
  upSql: string;
  downSql: string;
}

export interface MigrationStatus {
  name: string;
  applied: boolean;
}

const ENSURE_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;

export async function loadMigrations(dir: string): Promise<Migration[]> {
  const files = await readdir(dir);
  const ups = files.filter((f) => f.endsWith('.up.sql')).sort();
  return Promise.all(
    ups.map(async (upFile) => {
      const name = upFile.replace(/\.up\.sql$/, '');
      const downFile = `${name}.down.sql`;
      if (!files.includes(downFile)) {
        throw new Error(`Migration ${name} has no paired down file (${downFile})`);
      }
      return {
        name,
        upSql: await readFile(path.join(dir, upFile), 'utf8'),
        downSql: await readFile(path.join(dir, downFile), 'utf8'),
      };
    }),
  );
}

async function appliedNames(pool: Pool): Promise<Set<string>> {
  await pool.query(ENSURE_TABLE);
  const res = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
  return new Set(res.rows.map((r: { name: string }) => r.name));
}

/** Apply all pending migrations in order. Each runs in its own transaction. */
export async function migrateUp(pool: Pool, dir: string): Promise<string[]> {
  const migrations = await loadMigrations(dir);
  const applied = await appliedNames(pool);
  const ran: string[] = [];
  for (const m of migrations) {
    if (applied.has(m.name)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(m.upSql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [m.name]);
      await client.query('COMMIT');
      ran.push(m.name);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${m.name} failed: ${(err as Error).message}`, { cause: err });
    } finally {
      client.release();
    }
  }
  return ran;
}

/** Revert the last `steps` applied migrations (default 1), newest first. */
export async function migrateDown(pool: Pool, dir: string, steps = 1): Promise<string[]> {
  const migrations = await loadMigrations(dir);
  const applied = await appliedNames(pool);
  const toRevert = migrations
    .filter((m) => applied.has(m.name))
    .sort((a, b) => b.name.localeCompare(a.name))
    .slice(0, steps);
  const reverted: string[] = [];
  for (const m of toRevert) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(m.downSql);
      await client.query('DELETE FROM schema_migrations WHERE name = $1', [m.name]);
      await client.query('COMMIT');
      reverted.push(m.name);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Rollback ${m.name} failed: ${(err as Error).message}`, { cause: err });
    } finally {
      client.release();
    }
  }
  return reverted;
}

export async function migrationStatus(pool: Pool, dir: string): Promise<MigrationStatus[]> {
  const migrations = await loadMigrations(dir);
  const applied = await appliedNames(pool);
  return migrations.map((m) => ({ name: m.name, applied: applied.has(m.name) }));
}
