-- 0003_sequences down.
ALTER TABLE campaigns DROP CONSTRAINT campaigns_sequence_id_fkey;

DROP TABLE step_variants;
DROP TABLE sequence_steps;
DROP TABLE sequences;
