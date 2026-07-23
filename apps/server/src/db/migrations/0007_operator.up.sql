-- 0007_operator: the single operator account (decision I). Deferred from 0002
-- because the row needs an argon2id hash of OPERATOR_INITIAL_PASSWORD — created
-- at first boot by ensureOperator (services/operatorAuth.ts), not in SQL.
-- Also: incoming_messages.body_text — the unibox detail view serves full reply
-- text (docs/10 Unibox); the 300-char snippet alone was a schema/contract gap
-- reconciled 2026-07-23 (operator decision, PROGRESS.md log).

CREATE TABLE operator (
  id            int PRIMARY KEY CHECK (id = 1),  -- single-row, like settings
  email         text NOT NULL,
  password_hash text NOT NULL,                   -- argon2id (decision I)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- app_rw gets SELECT/INSERT/UPDATE/DELETE via 0001's default privileges.

-- Full unquoted reply text for the unibox detail view; the poller fills it
-- going forward (snippet stays the 300-char list-view field).
ALTER TABLE incoming_messages ADD COLUMN body_text text;
