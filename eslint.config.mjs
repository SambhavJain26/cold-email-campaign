import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';

// ── Module-boundary building blocks (docs/02 §1) ─────────────────────────────
// NOTE: flat config does NOT merge a rule's options across matching blocks -
// last match wins per rule. So the blocks below PARTITION apps/server/src:
// every file matches exactly one no-restricted-imports block.

const banDrizzle = {
  group: ['drizzle-orm', 'drizzle-orm/*'],
  message: 'Only db/ may import Drizzle -- repos are the SQL boundary (docs/02 s1).',
};
const banConcreteTransports = {
  group: [
    '**/transport/mock',
    '**/transport/mock/**',
    '**/transport/smtpImap',
    '**/transport/smtpImap/**',
  ],
  message:
    'Only composition.ts wires concrete transports -- depend on transport/types (docs/02 s1).',
};
const banConcreteClocks = {
  group: ['**/clock/system*', '**/clock/virtual*'],
  message:
    'Only composition.ts (and tests) use concrete clocks -- depend on the Clock interface (docs/02 s1).',
};
const banConcreteSuggester = {
  group: ['**/sentiment/anthropic*'],
  message:
    'Only composition.ts wires the Anthropic adapter -- depend on sentiment/types (decision E).',
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'apps/web/public/mockServiceWorker.js', // MSW-generated
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // _-prefix = intentionally unused (interface conformance, catch slots)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  // 1. domain/ is pure: nothing outside domain/, no infra packages.
  {
    files: ['apps/server/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../**'],
              message:
                'domain/ is pure -- it may only import within domain/ and from @coldemail/shared (docs/02 s1).',
            },
            {
              group: [
                'drizzle-orm*',
                'fastify*',
                'pg',
                'pg-*',
                'nodemailer*',
                'imapflow*',
                'mailparser*',
                'pino*',
              ],
              message: 'domain/ must not import infrastructure packages (docs/02 s1).',
            },
          ],
        },
      ],
    },
  },

  // 2. db/ may use Drizzle, but not transports/clocks/suggesters.
  {
    files: ['apps/server/src/db/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [banConcreteTransports, banConcreteClocks, banConcreteSuggester] },
      ],
    },
  },

  // 3. transport/, clock/, sentiment/, composition.ts: may use their concretes,
  //    but not Drizzle.
  {
    files: [
      'apps/server/src/transport/**/*.ts',
      'apps/server/src/clock/**/*.ts',
      'apps/server/src/sentiment/**/*.ts',
      'apps/server/src/composition.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', { patterns: [banDrizzle] }],
    },
  },

  // 4. everything else in src/: no Drizzle, no concrete transports/clocks/suggesters.
  {
    files: ['apps/server/src/**/*.ts'],
    ignores: [
      'apps/server/src/domain/**',
      'apps/server/src/db/**',
      'apps/server/src/transport/**',
      'apps/server/src/clock/**',
      'apps/server/src/sentiment/**',
      'apps/server/src/composition.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [banDrizzle, banConcreteTransports, banConcreteClocks, banConcreteSuggester] },
      ],
    },
  },

  // ── apps/web (docs/11 §1) ──────────────────────────────────────────────────
  // features/ may import components/*, api/*, lib - never each other; all server
  // data flows through api/queries hooks (no raw fetch in features).
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    files: ['apps/web/src/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/*/*', '../../features/**'],
              message: 'features may not import each other (docs/11 s1).',
            },
          ],
        },
      ],
    },
  },

  prettier,
);
