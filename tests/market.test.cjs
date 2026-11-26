'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createStore, getReference, convertHistory, scenario, indicators, isoDay } = require('../market.js');
const day = 86400000;
const clock = Date.parse('2026-11-24T17:00:00Z');
const makeSeries = (count, quote = () => 2000) => Array.from({ length: count }, (_, index) => ({
  date: isoDay(clock - (count - index - 1) * day), price: quote(index),
}));
const apiRows = (series) => series.map(({ date, price }) => ({ date, base: 'XAU', quote: 'USD', rate: price }));

test('period scenarios require enough observations and use only known data at each test origin', () => {
  assert.equal(scenario(makeSeries(250), 22), null);
  for (const period of [5, 10, 22]) {
    const rows = makeSeries(500);
    const flat = scenario(rows, period);
    assert.deepEqual([flat.low, flat.median, flat.high], [2000, 2000, 2000]);
    assert.equal(flat.validation.coverage, 100);
    assert.equal(flat.validation.mape, 0);
    assert.equal(flat.validation.baselineMape, 0);
    assert.equal(flat.validation.samples, Math.floor((rows.length - (252 + period)) / period));

    const next = makeSeries(252 + 2 * period, (index) => index >= 252 + period ? 3000 : 2000);
    const shock = scenario(next, period);
    assert.equal(shock.validation.samples, 1);
    assert.equal(shock.validation.coverage, 0);
    assert.equal(shock.validation.mape, shock.validation.baselineMape);
    assert(Math.abs(shock.validation.mape - 100 / 3) < 1e-10);
  }
});

test('historical trend and volatility are consistent for a constant reference', () => {
  assert.equal(indicators(makeSeries(60)), null);
  assert.deepEqual(indicators(makeSeries(61)), { weekly: 0, monthly: 0, average60: 2000, deviation: 0, volatility: 0 });
});

test('newer daily reference takes priority over an old quotation and FX is dated independently', () => {
  const history = makeSeries(4);
  const state = {
    quote: { value: { price: 2100, time: clock - 2 * day } },
    history: { value: history },
    fx: { value: { rate: 7, date: isoDay(clock) } },
  };
  const reference = getReference(state, clock);
  assert.equal(reference.source, 'history');
  assert.equal(reference.cny, 14000 / 31.1034768);
  state.quote.value.time = clock;
  assert.equal(getReference(state, clock).source, 'quote');
  state.fx.value.date = isoDay(clock - 8 * day);
  assert.equal(getReference(state, clock).cny, null);
});

test('yuan chart joins on exact dates and headline conversion never uses a future fixing', () => {
  const rows = makeSeries(4);
  const rates = [{ date: rows[1].date, rate: 6 }, { date: rows[3].date, rate: 7 }];
  assert.deepEqual(convertHistory(rows, rates), [
    { date: rows[1].date, price: 12000 / 31.1034768 },
    { date: rows[3].date, price: 14000 / 31.1034768 },
  ]);
  const state = {
    quote: { value: null }, history: { value: rows.slice(0, 3) },
    fx: { value: rates[1] }, fxHistory: { value: rates },
  };
  const reference = getReference(state, clock);
  assert.equal(reference.fxSource, 'fxHistory');
  assert.equal(reference.fx.date, rows[1].date);
  assert.equal(reference.cny, 12000 / 31.1034768);
  state.history.value = rows;
  assert.equal(getReference(state, clock).fxSource, 'fx');
});

test('providers refresh independently, reject date regression and preserve recoverable state', async () => {
  const records = new Map();
  const storage = { getItem: (key) => records.get(key), setItem: (key, value) => records.set(key, value) };
  let currentTime = clock;
  let mode = 'online';
  const calls = [];
  const options = { storage, now: () => currentTime, onChange() {},
    fetchJson: async (url) => {
      calls.push(url);
      if (url.includes('gold-api')) {
        return { symbol: 'XAU', currency: 'USD', price: mode === 'online' ? 2400 : 2300,
          updatedAt: new Date(mode === 'online' ? clock : clock - day).toISOString() };
      }
      if (url.includes('quotes=USD')) {
        if (mode !== 'online') throw Error('offline history');
        return apiRows(makeSeries(300));
      }
      if (url.includes('quotes=CNY')) {
        const dates = mode === 'online' ? makeSeries(300) : makeSeries(300).slice(0, -1);
        return dates.map(({ date }) => ({ date, base: 'USD', quote: 'CNY', rate: 7 }));
      }
      return { base: 'USD', quote: 'CNY', date: isoDay(clock), rate: 7 };
    },
  };
  const store = createStore(options);
  const first = store.refresh();
  assert.equal(store.refresh(), first);
  await first;
  assert.equal(calls.length, 4);
  assert.equal(store.state.history.value.length, 300);
  await store.refresh(true);
  assert.equal(calls.length, 4);
  currentTime += 60000;
  mode = 'failure';
  await store.refresh(true);
  assert.equal(store.state.quote.value.price, 2400);
  assert.equal(store.state.quote.error, true);
  assert.equal(store.state.history.error, true);
  assert.equal(store.state.fx.error, false);
  assert.equal(store.state.fxHistory.error, true);
  const restored = createStore(options);
  assert.equal(restored.state.quote.value.price, 2400);
  assert.equal(restored.state.history.value.length, 300);
  assert.equal(restored.state.fx.value.rate, 7);
  assert.equal(restored.state.fxHistory.value.at(-1).date, isoDay(clock));
});
