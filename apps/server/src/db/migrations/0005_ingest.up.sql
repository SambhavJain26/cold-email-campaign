-- 0005_ingest: imports + import_rows (docs/03 §3, docs/09) + the
-- leads.import_id FK deferred from 0001. Lands after 0006 by filename-order
-- backfill (same pattern as 0003/0004); nothing in 0006 depends on these.
-- suppressions moved UP into 0001 during B1 - not here.

CREATE TYPE import_row_flag AS ENUM
  ('ok', 'missing_first_name', 'role_based', 'invalid', 'duplicate', 'suppressed');

CREATE TABLE imports (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  filename       text NOT NULL,
  rows_total     int NOT NULL,
  counts         jsonb NOT NULL,      -- {"ok":885,"role_based":60,"invalid":40,...}
  committed      bool NOT NULL DEFAULT false,
  commit_mode    text,                -- 'drop_flagged' | 'import_all'
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Preview rows persist so commit is exact even if the operator commits later
-- (docs/09 §2).
CREATE TABLE import_rows (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_id bigint NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  row_no    int NOT NULL,
  raw       jsonb NOT NULL,           -- canonical fields + custom_fields, as parsed
  email_normalized text,
  flag      import_row_flag NOT NULL,
  lead_id   bigint REFERENCES leads(id)   -- set on commit for imported rows
);
CREATE INDEX ir_import_flag ON import_rows (import_id, flag);

-- FK deferred from 0001 (leads.import_id existed as plain bigint).
ALTER TABLE leads
  ADD CONSTRAINT leads_import_id_fkey
  FOREIGN KEY (import_id) REFERENCES imports(id);
