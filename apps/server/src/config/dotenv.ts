import { existsSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

/**
 * Load the repo-root .env regardless of cwd (npm workspace scripts run with
 * cwd = the workspace dir). Walks up from cwd until a .env or .git is found.
 * No-op if no .env exists (e.g. CI, where env comes from the runner).
 */
export function loadDotenv(): void {
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, '.env');
    if (existsSync(candidate)) {
      dotenv.config({ path: candidate, quiet: true });
      return;
    }
    if (existsSync(path.join(dir, '.git'))) return; // repo root reached, no .env
    const parent = path.dirname(dir);
    if (parent === dir) return; // filesystem root
    dir = parent;
  }
}
