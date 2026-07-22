-- 0005_ingest down.
ALTER TABLE leads DROP CONSTRAINT leads_import_id_fkey;

DROP TABLE import_rows;
DROP TABLE imports;

DROP TYPE import_row_flag;
