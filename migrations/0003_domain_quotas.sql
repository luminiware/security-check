ALTER TABLE jobs ADD COLUMN host_bucket TEXT;
DROP TRIGGER job_admission;
DROP TRIGGER job_admitted;
CREATE TRIGGER job_admission BEFORE INSERT ON jobs
WHEN NOT EXISTS(SELECT 1 FROM jobs WHERE session_hash=NEW.session_hash AND idem_key=NEW.idem_key)
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM quotas
    WHERE bucket IN (NEW.session_bucket,NEW.domain_bucket,NEW.host_bucket,NEW.budget_bucket) AND used < limit_value) != 4
    THEN RAISE(ABORT, 'QUOTA_EXCEEDED') END;
END;
CREATE TRIGGER job_admitted AFTER INSERT ON jobs
BEGIN
  UPDATE quotas SET used=used+1 WHERE bucket IN (NEW.session_bucket,NEW.domain_bucket,NEW.host_bucket,NEW.budget_bucket);
  INSERT INTO events(entity_id,event,occurred_at) VALUES(NEW.id,'analysis_started',NEW.created_at);
END;
CREATE INDEX quotas_expiry ON quotas(expires_at);
CREATE INDEX jobs_lease ON jobs(state,lease_until);
