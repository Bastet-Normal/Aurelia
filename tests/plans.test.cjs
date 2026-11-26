'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validate, estimate, validatePurchase, purchaseProgress, normalizeRecord, encodeBackup, decodeBackup,
  mergeRecords, planCsv, priceComparison, planCalendar } = require('../plans.js');

const input = { name: '黄金计划', start: '2026-12-20', budget: '￥１，００１', risk: 'active', horizon: 'short', fee: '2.50', price: '500' };
const record = (overrides = {}) => normalizeRecord({ ...validate(input).value, id: 'plan-1', updatedAt: 100, ...overrides });

test('normalized settings yield exact budget and dated fee/weight estimates', () => {
  const { value } = validate(input);
  const plan = estimate(value);
  assert.deepEqual(plan.stages.map(({ amount }) => amount), [501, 300, 200]);
  assert.deepEqual(plan.stages.map(({ date }) => date), ['2026-12-20', '2027-01-10', '2027-02-03']);
  assert(Math.abs(plan.grams * 500 + plan.fee - 1001) < 1e-10);
  assert.equal(estimate({ ...value, price: null }).grams, null);
});

test('invalid input is recognized without silently correcting stored data', () => {
  assert.deepEqual(Object.keys(validate({
    name: '', budget: '999', start: '2026-02-30', price: '0', fee: '101', horizon: 'bogus',
  }).errors), ['name', 'budget', 'start', 'price', 'fee', 'settings']);
  assert.throws(() => decodeBackup(encodeBackup([{ ...record(), start: '2026-06-31' }])));
});

test('backups round trip, deduplicate repeated imports and preserve conflicting originals', () => {
  const original = record();
  const conflicting = record({ budget: 100000, updatedAt: 200 });
  assert.deepEqual(decodeBackup(encodeBackup([original])), [original]);
  const combined = mergeRecords([original], [original, conflicting], () => 'new-plan');
  assert.deepEqual(combined.map(({ id, budget }) => [id, budget]), [['plan-1', 1001], ['new-plan', 100000]]);
  assert.deepEqual(mergeRecords(combined, [conflicting], () => 'unused'), combined);
  assert.throws(() => decodeBackup('{"version":1,"plans":[]}'));
});

test('CSV escapes spreadsheet formulas and quotes', () => {
  const value = { ...record(), name: '=test("x")' };
  assert(planCsv(value, estimate(value)).includes("'=test(\"\"x\"\")"));
});

test('channel comparison includes buy charges and computes the gross recovery price', () => {
  const { result, errors } = priceComparison('10', { buy: '500', fixed: '50', buyRate: '2', sell: '510', sellRate: '5' });
  assert.deepEqual(errors, {});
  assert.equal(result.total, 5150);
  assert.equal(result.unit, 515);
  assert.equal(result.netSale, 4845);
  assert.equal(result.difference, -305);
  assert(Math.abs(result.breakEven * 10 * 0.95 - result.total) < 1e-9);
  assert.equal(priceComparison('１０', { buy: '500' }).result.netSale, null);
  assert.equal(priceComparison('10', {}).result, null);
  assert.deepEqual(Object.keys(priceComparison('0', { buy: '0', sellRate: '100' }).errors), ['grams', 'buy', 'sellRate']);
});

test('planning carries over unit and percentage fees and charges the fixed fee once per batch', () => {
  const { pricing } = priceComparison('10', { buy: '500', fixed: '50', buyRate: '2', sellRate: '5' });
  assert.deepEqual(pricing, { price: 500, fee: 2, fixedFee: 50 });
  const settings = validate({ ...input, ...pricing }).value;
  const plan = estimate(settings);
  assert.equal(plan.stages.reduce((sum, stage) => sum + stage.amount, 0), 1001);
  assert(Math.abs(plan.grams * 500 + plan.fee - 1001) < 1e-10);
  assert(Math.abs(plan.grams - (1001 - 3 * 50) / 1.02 / 500) < 1e-10);
  assert(validate({ ...input, fixedFee: '200' }).errors.fixedFee);
});

test('old backups restore an empty purchase log and actual spending survives backup and CSV export', () => {
  const older = { ...input, id: 'old-plan', updatedAt: 100 };
  const [migrated] = decodeBackup(JSON.stringify({ format: 'aurelia.plans', version: 1, plans: [older] }));
  assert.deepEqual(migrated.purchases, [null, null, null]);
  assert.equal(migrated.fixedFee, 0);
  const first = validatePurchase({ date: '2026-10-20', paid: '800.65', grams: '1.2345' }).value;
  const third = validatePurchase({ date: '2026-10-21', paid: '250.37', grams: '0.5' }).value;
  const saved = record({ purchases: [first, null, third] });
  assert.deepEqual(decodeBackup(encodeBackup([saved])), [saved]);
  const progress = purchaseProgress(saved.budget, saved.purchases);
  assert.equal(progress.count, 2);
  assert.equal(progress.spent, 1051.02);
  assert.equal(progress.grams, 1.7345);
  assert(Math.abs(progress.remaining + 50.02) < 1e-9);
  assert.equal(progress.average, 1051.02 / 1.7345);
  assert(planCsv(saved, estimate(saved)).includes('"2026-10-20","800.65","1.2345"'));
  assert(validatePurchase({ date: '2026-02-30', paid: '0', grams: '1.23456' }).value === null);
});

test('iCalendar events use all-day dates, stable identifiers and UTF-8 line folds', () => {
  const settings = record({ name: '黄金，白银;\\'.repeat(7) });
  const calendar = planCalendar(settings, 'plan-1', new Date('2026-12-19T14:05:32.100Z'));
  const unfolded = calendar.replaceAll('\r\n ', '');
  assert(calendar.endsWith('END:VCALENDAR\r\n'));
  assert(calendar.split('\r\n').every((line) => Buffer.byteLength(line) <= 75));
  assert.deepEqual([...unfolded.matchAll(/DTSTART;VALUE=DATE:(\d{8})/g)].map((match) => match[1]), ['20261220', '20270110', '20270203']);
  assert.equal([...unfolded.matchAll(/UID:plan-1-\d@aurelia.local/g)].length, 3);
  assert(unfolded.includes('DTSTAMP:20261219T140532Z'));
  assert(unfolded.includes('SUMMARY:黄金，白银\\;\\\\'));
});
