-- Retain vocabulary and cutoff: removing them would invalidate append-only
-- facts or change eligibility on re-apply. Roll back using a compatible release.
SELECT 1;
