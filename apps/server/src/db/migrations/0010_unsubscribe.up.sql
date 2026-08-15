-- Public one-click / link unsubscribe (docs/16 s8). The token is the ONLY
-- capability that identifies a recipient to the public endpoint, so only its
-- sha256 is stored: a database leak must not yield working unsubscribe URLs,
-- and the raw token exists solely in the delivered email.
--
-- One row per SEND ATTEMPT, not per enrollment. Storing the hash alone means a
-- raw token can never be recovered, so a soft-retry cannot re-use the original
-- and mints a fresh one instead; every token issued for an enrollment stays
-- valid, which is what CAN-SPAM's honour-the-opt-out window requires. This
-- deliberately does NOT derive the token from SECRET_KEY: rotating that key
-- would silently kill the unsubscribe link in every already-delivered email.
--
-- The unsubscribe event requires both enrollment_id and campaign_id, so both
-- are captured at issue time rather than re-derived at redeem time.
CREATE TABLE unsubscribe_tokens (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token_hash    text NOT NULL UNIQUE,             -- sha256 hex of the raw token
  enrollment_id bigint NOT NULL REFERENCES enrollments(id),
  lead_id       bigint NOT NULL REFERENCES leads(id),
  campaign_id   bigint NOT NULL REFERENCES campaigns(id),
  step_no       int NOT NULL,                     -- which send carried this token
  created_at    timestamptz NOT NULL DEFAULT now(),
  used_at       timestamptz                       -- set on first successful redeem
);

CREATE INDEX unsub_tok_enrollment ON unsubscribe_tokens (enrollment_id);

-- Base URL for the public endpoint, e.g. https://unsubscribe.example.com.
-- Empty is the normal state until a real sending domain exists: the renderer
-- then emits no link and no List-Unsubscribe header, and the footer falls back
-- to reply-STOP only.
ALTER TABLE compliance_settings ADD COLUMN unsubscribe_base_url text NOT NULL DEFAULT '';
