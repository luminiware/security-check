// Pure accounting helper; no tracking, CRM writes or unapproved commercial target.
export function funnelMetrics({ started, completed, leads, qualified, proposals, contracts, revenue, executionCost, deliveryCost }) {
  const fields = [started, completed, leads, qualified, proposals, contracts];
  if (fields.some(n => !Number.isInteger(n) || n < 0) || [revenue, executionCost, deliveryCost].some(n => !Number.isFinite(n) || n < 0)) throw new Error('INVALID_METRICS');
  const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;
  return { leads_per_started: ratio(leads, started), leads_per_completed: ratio(leads, completed),
    proposals_per_qualified: ratio(proposals, qualified), contracts_per_proposal: ratio(contracts, proposals),
    cost_per_completed: ratio(executionCost, completed), cost_per_qualified: ratio(executionCost, qualified),
    margin: revenue - executionCost - deliveryCost };
}
