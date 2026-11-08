CREATE TABLE lead_requests (
  session_hash TEXT NOT NULL, idem_key TEXT NOT NULL, request_hash TEXT NOT NULL,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  PRIMARY KEY(session_hash, idem_key)
);
INSERT INTO lead_requests(session_hash,idem_key,request_hash,lead_id)
  SELECT session_hash,idem_key,request_hash,id FROM leads;
CREATE INDEX lead_requests_lead ON lead_requests(lead_id);
