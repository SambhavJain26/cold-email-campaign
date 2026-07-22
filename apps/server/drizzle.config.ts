import { defineConfig } from 'drizzle-kit';

// drizzle-kit is used for GENERATING diff SQL from schema definitions only.
// Output lands in drizzle-kit-out/ (gitignored) and is hand-copied into
// src/db/migrations/ as paired .up.sql/.down.sql files — our runner
// (src/db/migrate.ts) is the only thing that executes migrations.
export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle-kit-out',
  dialect: 'postgresql',
});
