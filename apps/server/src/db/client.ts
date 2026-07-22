import './pg-types';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

/** The one place a Drizzle instance is created. Schema tables attach here from B1. */
export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  return { db: drizzle(pool), pool };
}

export type Db = ReturnType<typeof createDb>['db'];
