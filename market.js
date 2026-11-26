'use strict';

const aureliaMarket = (() => {
  const day = 86400000;
  const ounceGrams = 31.1034768;
  const periods = [5, 10, 22];
  const trainingSize = 252;
  const storageKey = 'aurelia-market-v1';
  const historyDays = 1120;
  const historyUrl = (base, quote, provider, now) =>
    'https://api.frankfurter.dev/v2/rates?base=' + base + '&quotes=' + quote
      + '&providers=' + provider + '&from=' + isoDay(now - historyDays * day);
  const sources = {
    quote: {
      ttl: 60000,
      url: () => 'https://api.gold-api.com/price/XAU',
      parse: (raw, now) => {
        const time = Date.parse(raw?.updatedAt);
        if (raw?.symbol !== 'XAU' || raw.currency !== 'USD' || !price(raw.price)
          || !Number.isFinite(time) || time > now + 120000) throw Error('Invalid spot quote');
        return { price: raw.price, time };
      },
    },
    history: {
      ttl: 4 * 3600000,
      url: (now) => historyUrl('XAU', 'USD', 'nbp.a', now),
      parse: (raw, now) => {
        if (!Array.isArray(raw) || raw.length < 2 || raw.length > 1500) throw Error('Invalid reference series');
        const byDate = new Map();
        for (const row of raw) {
          if (row?.base !== 'XAU' || row.quote !== 'USD' || !validDate(row.date) || row.date > isoDay(now) || !price(row.rate)) {
            throw Error('Invalid reference observation');
          }
          if (byDate.has(row.date) && byDate.get(row.date) !== row.rate) throw Error('Conflicting observations');
          byDate.set(row.date, row.rate);
        }
        if (byDate.size < 2) throw Error('Reference series requires more dates');
        return [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, price: value }));
      },
    },
    fx: {
      ttl: 4 * 3600000,
      url: () => 'https://api.frankfurter.dev/v2/providers/ecb/rate/USD/CNY',
      parse: (raw, now) => {
        if (raw?.base !== 'USD' || raw.quote !== 'CNY' || !validDate(raw.date)
          || raw.date > isoDay(now) || !price(raw.rate)) throw Error('Invalid FX reference');
        return { date: raw.date, rate: raw.rate };
      },
    },
    fxHistory: {
      ttl: 4 * 3600000,
      url: (now) => historyUrl('USD', 'CNY', 'ecb', now),
      parse: (raw, now) => {
        if (!Array.isArray(raw) || raw.length < 2 || raw.length > 1500) throw Error('Invalid FX series');
        const byDate = new Map();
        for (const row of raw) {
          const { date, rate } = sources.fx.parse(row, now);
          if (byDate.has(date) && byDate.get(date) !== rate) throw Error('Conflicting FX rates');
          byDate.set(date, rate);
        }
        if (byDate.size < 2) throw Error('FX series requires more dates');
        return [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, rate]) => ({ date, rate }));
      },
    },
  };

  function price(value) {
    return Number.isFinite(value) && value > 0 && value < 1000000;
  }

  function isoDay(time) {
    return new Date(time).toISOString().slice(0, 10);
  }

  function validDate(value) {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) && isoDay(parsed) === value;
  }

  function percentChange(value, reference) {
    return (value / reference - 1) * 100;
  }

  function toYuanPerGram(priceUsd, rate) {
    return priceUsd * rate / ounceGrams;
  }

  function convertHistory(rows, rates) {
    const byDate = new Map(rates.map(({ date, rate }) => [date, rate]));
    return rows.filter(({ date }) => byDate.has(date)).map(({ date, price }) => ({
      date, price: toYuanPerGram(price, byDate.get(date)),
    }));
  }

  function quantile(sorted, fraction) {
    const index = (sorted.length - 1) * fraction;
    const lower = Math.floor(index);
    return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower);
  }

  function distribution(rows, end, period) {
    const ratios = [];
    for (let i = end - trainingSize + 1; i <= end; i += 1) {
      ratios.push(rows[i].price / rows[i - period].price);
    }
    ratios.sort((a, b) => a - b);
    return [0.1, 0.5, 0.9].map((fraction) => quantile(ratios, fraction) * rows[end].price);
  }

  function scenario(rows, period) {
    const end = rows.length - 1;
    if (!periods.includes(period) || end < trainingSize + period - 1) return null;
    const [low, median, high] = distribution(rows, end, period);
    let samples = 0;
    let covered = 0;
    let error = 0;
    let baselineError = 0;
    let startDate;
    let endDate;
    // Each training distribution stops at the forecast origin.
    // Realized target windows are non-overlapping within each horizon.
    for (let origin = trainingSize + period - 1; origin + period <= end; origin += period) {
      const [lower, center, upper] = distribution(rows, origin, period);
      const target = rows[origin + period];
      samples += 1;
      covered += Number(lower <= target.price && target.price <= upper);
      error += Math.abs(center / target.price - 1);
      baselineError += Math.abs(rows[origin].price / target.price - 1);
      startDate ??= target.date;
      endDate = target.date;
    }
    return {
      anchor: rows[end],
      low, median, high,
      validation: samples ? {
        samples, coverage: 100 * covered / samples, mape: 100 * error / samples,
        baselineMape: 100 * baselineError / samples, startDate, endDate,
      } : null,
    };
  }

  function indicators(rows) {
    if (rows.length < 61) return null;
    const latest = rows.at(-1).price;
    const average60 = rows.slice(-60).reduce((sum, row) => sum + row.price, 0) / 60;
    const sample = rows.slice(-23);
    const returns = sample.slice(1).map((row, index) => Math.log(row.price / sample[index].price));
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
    return {
      weekly: percentChange(latest, rows.at(-6).price),
      monthly: percentChange(latest, rows.at(-23).price),
      average60, deviation: percentChange(latest, average60),
      volatility: Math.sqrt(variance * 252) * 100,
    };
  }

  function getReference(state, now) {
    const close = state.history.value?.at(-1);
    const quote = state.quote.value;
    const fx = state.fx.value;
    const quoteAge = quote ? now - quote.time : Infinity;
    const recentQuote = quoteAge <= 5 * 60000;
    const quoteDate = quote ? isoDay(quote.time) : '';
    const source = recentQuote || (quote && (!close || quoteDate >= close.date)) ? 'quote' : 'history';
    const value = source === 'quote' ? quote?.price : close?.price;
    const date = source === 'quote' ? quoteDate : close?.date;
    const fxNearDate = fx && date && fx.date <= date && Date.parse(date) - Date.parse(fx.date) <= 7 * day;
    const historicalRate = state.fxHistory?.value?.findLast((entry) => entry.date <= date);
    const priorRate = historicalRate && Date.parse(date) - Date.parse(historicalRate.date) <= 7 * day ? historicalRate : null;
    const useLatest = fxNearDate && (!priorRate || fx.date >= priorRate.date);
    const rate = useLatest ? fx : priorRate;
    return { source, value, date, recentQuote, close, quote, fx: rate, fxSource: useLatest ? 'fx' : 'fxHistory',
      cny: value && rate ? toYuanPerGram(value, rate.rate) : null };
  }

  function createStore({ storage, fetchJson, onChange, now = Date.now }) {
    const state = {};
    const entries = {};
    const attempts = {};
    let inFlight;
    let cached;

    try { cached = JSON.parse(storage.getItem(storageKey)); } catch { /* A cache is optional. */ }
    for (const [key, source] of Object.entries(sources)) {
      state[key] = { value: null, error: false };
      try {
        const record = cached?.[key];
        if (!Number.isFinite(record?.checkedAt) || record.checkedAt > now() + 120000) continue;
        const value = source.parse(record.raw, now());
        entries[key] = record;
        state[key] = { value, error: false, checkedAt: record.checkedAt };
      } catch { /* Reject corrupted cache entries individually. */ }
    }

    function refresh(force = false) {
      if (inFlight) return inFlight;
      const timestamp = now();
      const requests = Object.entries(sources).filter(([key, source]) => {
        const sinceAttempt = timestamp - (attempts[key] ?? -Infinity);
        const sinceSuccess = timestamp - (entries[key]?.checkedAt ?? -Infinity);
        return sinceAttempt >= 15000 && sinceSuccess >= (force ? 15000 : source.ttl);
      });
      inFlight = Promise.all(requests.map(async ([key, source]) => {
        attempts[key] = timestamp;
        try {
          const raw = await fetchJson(source.url(timestamp));
          const checkedAt = now();
          const value = source.parse(raw, checkedAt);
          const prior = state[key].value;
          if (key === 'quote' && prior && value.time < prior.time) throw Error('Quote went backwards');
          if (key === 'history' && prior && value.at(-1).date < prior.at(-1).date) throw Error('Reference series went backwards');
          if (key === 'fx' && prior && value.date < prior.date) throw Error('FX reference went backwards');
          if (key === 'fxHistory' && prior && value.at(-1).date < prior.at(-1).date) throw Error('FX series went backwards');
          state[key] = { value, checkedAt, error: false };
          entries[key] = { raw, checkedAt };
          try { storage.setItem(storageKey, JSON.stringify(entries)); } catch { /* Keep the in-memory data. */ }
        } catch {
          state[key].error = true;
        }
        onChange(state);
      })).finally(() => { inFlight = null; });
      return inFlight;
    }
    return { state, refresh };
  }

  return { createStore, sources, getReference, convertHistory, periods, percentChange, scenario, indicators, validDate, isoDay };
})();

if (typeof module === 'object' && module.exports) module.exports = aureliaMarket;
