-- Local, read-only snapshot. No contact, domain, cookie, token or report body
-- is selected. These are retained rows, not a permanent commercial ledger.
SELECT 'retained_events' AS scope,event,COUNT(*) AS total
FROM events GROUP BY event ORDER BY event;

SELECT 'retained_jobs' AS scope,CASE WHEN scenario IS NULL THEN 'real' ELSE 'synthetic' END AS mode,
  state,COUNT(*) AS total,
  SUM(CASE WHEN json_extract(result_json,'$.score') IS NOT NULL THEN 1 ELSE 0 END) AS with_score,
  SUM(CASE WHEN json_extract(result_json,'$.label')='Parcial' THEN 1 ELSE 0 END) AS partial,
  SUM(CASE WHEN json_extract(result_json,'$.coverage')=0 THEN 1 ELSE 0 END) AS inconclusive
FROM jobs WHERE target!='' GROUP BY mode,state ORDER BY mode,state;

SELECT 'retained_leads' AS scope,CASE WHEN j.scenario IS NULL THEN 'real' ELSE 'synthetic' END AS mode,
  l.state,COUNT(*) AS total
FROM leads l JOIN jobs j ON j.id=l.job_id WHERE j.target!=''
GROUP BY mode,l.state ORDER BY mode,l.state;

-- Nearest-rank percentiles. Queue wait ends at the FIRST claim, not a retry.
-- Total includes terminal failures/deadlines. Last attempt window is not CPU.
WITH retained AS (
  SELECT date(j.created_at/1000,'unixepoch') AS cohort_utc,
    CASE WHEN j.scenario IS NULL THEN 'real' ELSE 'synthetic' END AS mode,
    j.created_at,j.finished_at,j.attempt_started_at,
    (SELECT MIN(a.started_at) FROM attempts a WHERE a.job_id=j.id) AS first_claim
  FROM jobs j WHERE j.target!=''
), samples AS (
  SELECT cohort_utc,mode,'total_ms' AS metric,finished_at-created_at AS value FROM retained WHERE finished_at>=created_at
  UNION ALL
  SELECT cohort_utc,mode,'queue_ms',first_claim-created_at FROM retained WHERE first_claim>=created_at
  UNION ALL
  SELECT cohort_utc,mode,'last_attempt_window_ms',finished_at-attempt_started_at FROM retained WHERE finished_at>=attempt_started_at
), ranked AS (
  SELECT *,ROW_NUMBER() OVER(PARTITION BY cohort_utc,mode,metric ORDER BY value) AS rank,
    COUNT(*) OVER(PARTITION BY cohort_utc,mode,metric) AS samples FROM samples
)
SELECT 'retained_jobs' AS scope,cohort_utc,mode,metric,MAX(samples) AS samples,
  ROUND(AVG(value),0) AS average,
  MIN(CASE WHEN rank>=samples*0.50 THEN value END) AS p50,
  MIN(CASE WHEN rank>=samples*0.95 THEN value END) AS p95
FROM ranked GROUP BY cohort_utc,mode,metric ORDER BY cohort_utc,mode,metric;

-- Cumulative help requests for the job's UTC creation cohort. No qualification,
-- proposals, contracts, revenue, CPU/RAM or costs are inferred here.
WITH cohort AS (
  SELECT date(j.created_at/1000,'unixepoch') AS cohort_utc,
    CASE WHEN j.scenario IS NULL THEN 'real' ELSE 'synthetic' END AS mode,
    j.state,(SELECT COUNT(*) FROM leads l WHERE l.job_id=j.id) AS leads
  FROM jobs j WHERE j.target!=''
)
SELECT 'retained_jobs' AS scope,cohort_utc,mode,COUNT(*) AS started,
  SUM(CASE WHEN state='concluído' THEN 1 ELSE 0 END) AS completed,
  SUM(CASE WHEN state='falhou' THEN 1 ELSE 0 END) AS failed,
  SUM(CASE WHEN state='expirou' THEN 1 ELSE 0 END) AS expired,
  SUM(CASE WHEN state IN ('pendente','executando') THEN 1 ELSE 0 END) AS active,
  SUM(leads) AS leads,1.0*SUM(leads)/COUNT(*) AS leads_per_started,
  1.0*SUM(leads)/NULLIF(SUM(CASE WHEN state='concluído' THEN 1 ELSE 0 END),0) AS leads_per_completed
FROM cohort GROUP BY cohort_utc,mode ORDER BY cohort_utc,mode;
