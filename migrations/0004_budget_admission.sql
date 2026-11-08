DROP TRIGGER job_admission;
CREATE TRIGGER job_admission BEFORE INSERT ON jobs
WHEN NOT EXISTS(SELECT 1 FROM jobs WHERE session_hash=NEW.session_hash AND idem_key=NEW.idem_key)
BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM quotas WHERE bucket=NEW.budget_bucket AND used>=limit_value)
    THEN RAISE(ABORT, 'BUDGET_EXHAUSTED') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM quotas
    WHERE bucket IN (NEW.session_bucket,NEW.domain_bucket,NEW.host_bucket,NEW.budget_bucket) AND used < limit_value) != 4
    THEN RAISE(ABORT, 'QUOTA_EXCEEDED') END;
END;
