import { test } from 'node:test';
import assert from 'node:assert/strict';
import { funnelMetrics } from '../src/economics.js';
test('funnel uses explicit denominators and supplied accounting; zero denominator is null', () => {
  const empty = { started: 0, completed: 0, leads: 0, qualified: 0, proposals: 0, contracts: 0, revenue: 0, executionCost: 0, deliveryCost: 0 };
  assert.equal(funnelMetrics(empty).leads_per_started, null);
  const result = funnelMetrics({ started: 10, completed: 8, leads: 4, qualified: 2, proposals: 1, contracts: 1, revenue: 100, executionCost: 10, deliveryCost: 30 });
  assert.equal(result.leads_per_completed, .5); assert.equal(result.proposals_per_qualified, .5); assert.equal(result.margin, 60);
  assert.throws(() => funnelMetrics({ ...empty, executionCost: -1 }), /INVALID_METRICS/u);
});
