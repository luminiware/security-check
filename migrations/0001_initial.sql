PRAGMA foreign_keys = ON;
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, session_hash TEXT NOT NULL, idem_key TEXT NOT NULL,
  request_hash TEXT NOT NULL, target TEXT NOT NULL, scenario TEXT,
  state TEXT NOT NULL CHECK(state IN ('pendente','executando','concluído','falhou','expirou')),
  created_at INTEGER NOT NULL, deadline_at INTEGER NOT NULL, retain_until INTEGER NOT NULL,
  finished_at INTEGER, attempt_id TEXT, attempts INTEGER NOT NULL DEFAULT 0,
  lease_hash TEXT, lease_until INTEGER, executor_id TEXT, attempt_started_at INTEGER,
  dispatch_pending INTEGER NOT NULL DEFAULT 1, dispatch_tries INTEGER NOT NULL DEFAULT 0,
  dispatch_after INTEGER NOT NULL DEFAULT 0, result_hash TEXT, result_json TEXT,
  failure_code TEXT, versions_json TEXT NOT NULL,
  session_bucket TEXT NOT NULL, domain_bucket TEXT NOT NULL, budget_bucket TEXT NOT NULL,
  UNIQUE(session_hash, idem_key)
);
CREATE INDEX jobs_dispatch ON jobs(dispatch_pending, dispatch_after);
CREATE INDEX jobs_deadline ON jobs(state, deadline_at);
CREATE INDEX jobs_retention ON jobs(retain_until);
CREATE INDEX jobs_session_created ON jobs(session_hash, created_at);
CREATE TABLE attempts (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL, executor_id TEXT NOT NULL, started_at INTEGER NOT NULL,
  lease_until INTEGER NOT NULL, finished_at INTEGER, result_hash TEXT,
  UNIQUE(job_id, ordinal)
);
CREATE TABLE executor_health (
  id TEXT PRIMARY KEY, updated_at INTEGER NOT NULL, free_slots INTEGER NOT NULL,
  versions_json TEXT NOT NULL, healthy INTEGER NOT NULL CHECK(healthy IN (0,1))
);
CREATE TABLE quotas (
  bucket TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL,
  limit_value INTEGER NOT NULL
);
CREATE TRIGGER job_admission BEFORE INSERT ON jobs
WHEN NOT EXISTS(SELECT 1 FROM jobs WHERE session_hash=NEW.session_hash AND idem_key=NEW.idem_key)
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM quotas WHERE bucket IN (NEW.session_bucket,NEW.domain_bucket,NEW.budget_bucket) AND used < limit_value) != 3
  THEN RAISE(ABORT, 'QUOTA_EXCEEDED') END;
END;
CREATE TRIGGER job_admitted AFTER INSERT ON jobs
BEGIN
  UPDATE quotas SET used=used+1 WHERE bucket IN (NEW.session_bucket,NEW.domain_bucket,NEW.budget_bucket);
  INSERT INTO events(entity_id,event,occurred_at) VALUES(NEW.id,'analysis_started',NEW.created_at);
END;
CREATE TABLE leads (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL, idem_key TEXT NOT NULL, request_hash TEXT NOT NULL,
  email TEXT NOT NULL, name TEXT, intention TEXT, consent_version TEXT NOT NULL,
  consent_at INTEGER NOT NULL, summary_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pendente','enviado','revisão_manual','excluído')),
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL,
  retain_until INTEGER NOT NULL, crm_id TEXT, last_code TEXT,
  UNIQUE(session_hash, idem_key), UNIQUE(job_id, email)
);
CREATE INDEX leads_pending ON leads(state, next_attempt_at);
CREATE INDEX leads_retention ON leads(retain_until);
CREATE TABLE events (
  entity_id TEXT NOT NULL, event TEXT NOT NULL, occurred_at INTEGER NOT NULL,
  PRIMARY KEY(entity_id, event)
);
CREATE INDEX events_time ON events(occurred_at);
CREATE TRIGGER job_claimed AFTER UPDATE OF attempt_id ON jobs
WHEN NEW.attempt_id IS NOT NULL AND NEW.attempt_id IS NOT OLD.attempt_id
BEGIN
  INSERT INTO attempts(id,job_id,ordinal,executor_id,started_at,lease_until)
    VALUES(NEW.attempt_id,NEW.id,NEW.attempts,NEW.executor_id,NEW.attempt_started_at,NEW.lease_until);
END;
CREATE TRIGGER job_finished AFTER UPDATE OF state ON jobs
WHEN NEW.state IN ('concluído','falhou','expirou') AND OLD.state NOT IN ('concluído','falhou','expirou')
BEGIN
  INSERT OR IGNORE INTO events(entity_id,event,occurred_at) VALUES(NEW.id,'analysis_'||NEW.state,NEW.finished_at);
  UPDATE attempts SET finished_at=NEW.finished_at,result_hash=NEW.result_hash WHERE id=NEW.attempt_id;
END;
