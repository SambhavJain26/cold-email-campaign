-- Stage 3: durable campaign- and enrollment-level provenance for recycling
-- completed leads from multiple source campaigns into one draft target.

CREATE TABLE campaign_recycle_sources (
  target_campaign_id bigint NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  source_campaign_id bigint NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  selected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (target_campaign_id, source_campaign_id),
  CHECK (target_campaign_id <> source_campaign_id)
);

CREATE TABLE recycle_enrollment_sources (
  target_enrollment_id bigint NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  source_campaign_id bigint NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  source_enrollment_id bigint NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (target_enrollment_id, source_enrollment_id)
);

CREATE INDEX recycle_enrollment_sources_campaign
  ON recycle_enrollment_sources (source_campaign_id, target_enrollment_id);

-- Preserve every existing Pass-2 campaign and attribute its already-created
-- target enrollments to matching lead enrollments in the legacy source.
INSERT INTO campaign_recycle_sources (target_campaign_id, source_campaign_id, selected_at)
SELECT id, recycled_from_campaign_id, created_at
FROM campaigns
WHERE recycled_from_campaign_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO recycle_enrollment_sources
  (target_enrollment_id, source_campaign_id, source_enrollment_id, created_at)
SELECT target_enrollment.id, source_campaign.id, source_enrollment.id, target_enrollment.enrolled_at
FROM campaigns target_campaign
JOIN campaigns source_campaign
  ON source_campaign.id = target_campaign.recycled_from_campaign_id
JOIN enrollments target_enrollment
  ON target_enrollment.campaign_id = target_campaign.id
JOIN enrollments source_enrollment
  ON source_enrollment.campaign_id = source_campaign.id
 AND source_enrollment.lead_id = target_enrollment.lead_id
ON CONFLICT DO NOTHING;
