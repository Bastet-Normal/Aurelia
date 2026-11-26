'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  risks, horizons, parseBudget, restorePlan, buildPlan,
} = require('../model.js');

test('the minimum budget keeps the displayed steady weights and total', () => {
  const { stages } = buildPlan({ budget: 1000, horizon: 'mid', risk: 'steady' });
  assert.deepEqual(stages.map(({ amount }) => amount), [300, 350, 350]);
  assert.deepEqual(stages.map(({ weight }) => weight), [30, 35, 35]);
});

test('all supported preferences allocate every yuan including at numeric limits', () => {
  const budgets = [
    ...Array.from({ length: 100 }, (_, offset) => 1000 + offset),
    54321, 100000, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER,
  ];

  for (const risk of Object.keys(risks)) {
    for (const horizon of Object.keys(horizons)) {
      for (const budget of budgets) {
        const { stages } = buildPlan({ budget, horizon, risk });
        assert.deepEqual(stages.map(({ days }) => days), horizons[horizon].days);
        assert.deepEqual(stages.map(({ weight }) => weight), risks[risk].weights);
        assert.equal(stages.reduce((total, { amount }) => total + amount, 0), budget);
        assert(stages.every(({ amount, weight }) => Number.isSafeInteger(amount) && Math.abs(amount - budget * (weight / 100)) <= 1));
      }
    }
  }
});

test('budget validation rejects invalid or imprecise values and saved settings recover by field', () => {
  for (const value of [undefined, '', ' ', '999', '-1000', '1e4', '10,00', '1000.5', '9007199254740992']) {
    assert.equal(parseBudget(value), null, String(value));
  }

  assert.equal(parseBudget(' 01234 '), 1234);
  assert.equal(parseBudget('￥１２，３４５'), 12345);
  assert.equal(parseBudget('¥ 98,765'), 98765);
  assert.deepEqual(restorePlan({ budget: '2001', risk: 'active' }), { budget: 2001, horizon: 'mid', risk: 'active' });
  assert.deepEqual(restorePlan({ budget: '0', risk: 'constructor', horizon: '__proto__' }), { budget: 100000, horizon: 'mid', risk: 'steady' });
});
