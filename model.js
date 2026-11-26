'use strict';

const aureliaModel = (() => {
  const minimumBudget = 1000;
  const defaultPlan = Object.freeze({ budget: 100000, horizon: 'mid', risk: 'steady' });
  const risks = Object.freeze({
    steady: { title: '首批三成', weights: [30, 35, 35], description: '把更多预算留给后两批。' },
    balanced: { title: '首批四成', weights: [40, 35, 25], description: '首批安排四成预算，剩余分两次复盘。' },
    active: { title: '首批一半', weights: [50, 30, 20], description: '把一半预算安排在首批。' },
  });
  const horizons = Object.freeze({
    short: { title: '3–6 个月', days: [0, 21, 45] },
    mid: { title: '1–3 年', days: [0, 45, 135] },
    long: { title: '3 年以上', days: [0, 135, 270] },
  });

  function parseBudget(value) {
    const text = String(value ?? '').normalize('NFKC').trim().replace(/^¥\s*/, '');
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) return null;
    const amount = Number(text.replaceAll(',', ''));
    return Number.isSafeInteger(amount) && amount >= minimumBudget ? amount : null;
  }

  function restorePlan(value) {
    return {
      budget: parseBudget(value?.budget) ?? defaultPlan.budget,
      horizon: Object.hasOwn(horizons, value?.horizon) ? value.horizon : defaultPlan.horizon,
      risk: Object.hasOwn(risks, value?.risk) ? value.risk : defaultPlan.risk,
    };
  }

  function buildPlan(input) {
    const { budget, horizon, risk } = restorePlan(input);
    const { weights, description } = risks[risk];
    // Work in whole hundreds and a remainder to keep every calculation within safe integer precision.
    const hundreds = Math.floor(budget / 100);
    const remainder = budget % 100;
    const stages = weights.map((weight, index) => ({
      weight,
      amount: hundreds * weight + Math.floor(remainder * weight / 100),
      days: horizons[horizon].days[index],
    }));
    const unallocated = budget - stages.reduce((total, stage) => total + stage.amount, 0);
    const byFraction = stages.slice().sort((a, b) => (remainder * b.weight % 100) - (remainder * a.weight % 100));
    for (const stage of byFraction.slice(0, unallocated)) stage.amount += 1;
    return { budget, horizon, risk, stages, description };
  }

  return {
    defaultPlan, risks, horizons, parseBudget, restorePlan, buildPlan,
  };
})();

if (typeof module === 'object' && module.exports) module.exports = aureliaModel;
