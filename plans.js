'use strict';

const aureliaPlans = (() => {
  const model = typeof module === 'object' && module.exports ? require('./model.js') : aureliaModel;
  const { validDate, isoDay } = typeof module === 'object' && module.exports ? require('./market.js') : aureliaMarket;
  const storageKey = 'aurelia-plans-v3';
  const previousStorageKeys = ['aurelia-plans-v2', 'aurelia-plans-v1'];
  const backupFormat = 'aurelia.plans';
  const maxBatches = 24;
  const maxTrades = 1000;
  const day = 86400000;

  function today(date = new Date()) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0')
      + '-' + String(date.getDate()).padStart(2, '0');
  }

  function addDays(date, days) {
    return isoDay(Date.parse(date) + days * day);
  }

  function decimal(value, max, places = 2) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const text = String(value).normalize('NFKC').trim();
    const amount = Number(text);
    return /^\d+(?:\.\d+)?$/.test(text) && (text.split('.')[1]?.length ?? 0) <= places && amount <= max ? amount : NaN;
  }

  const isId = (value) => typeof value === 'string' && /^[a-z0-9-]{1,80}$/i.test(value);
  const isDate = (value) => validDate(value) && value >= '1900-01-01' && value <= '9998-12-31';
  const isTimestamp = (value) => Number.isFinite(value) && value >= 0 && value <= 8640000000000000;
  const cleanLabel = (value, limit) => typeof value === 'string' && value.trim().length <= limit && !/[\r\n\t]/.test(value)
    ? value.trim() : '';

  function presetSchedule(settings) {
    return model.buildPlan(settings).stages.map(({ amount, days, weight }, index) => ({
      id: 'batch-' + (index + 1), date: isDate(settings.start) ? addDays(settings.start, days) : '', amount, weight,
    }));
  }

  function normalizeSchedule(rows, budget) {
    if (!Array.isArray(rows) || !rows.length || rows.length > maxBatches) {
      return { error: '请保留 1–' + maxBatches + ' 个批次。' };
    }
    const ids = new Set();
    const schedule = [];
    let remaining = budget;
    for (const row of rows) {
      const amount = model.parseYuan(row?.amount);
      if (!isId(row?.id) || ids.has(row.id) || !isDate(row.date) || amount === null || amount < 1) {
        return { error: '每个批次都需要有效日期和至少 ¥1 的整数金额。' };
      }
      ids.add(row.id);
      schedule.push({ id: row.id, date: row.date, amount });
      if (amount > remaining) return { error: '批次金额超出总预算。' };
      remaining -= amount;
    }
    if (remaining) return { error: '批次金额合计须等于总预算。' };
    return { schedule };
  }

  function validate(input) {
    const budget = model.parseBudget(input?.budget);
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    const price = decimal(input?.price, 1000000);
    const fee = decimal(input?.fee, 100) ?? 0;
    const fixedFee = decimal(input?.fixedFee, 1000000) ?? 0;
    const scheduleInput = input?.schedule;
    const custom = scheduleInput !== null && scheduleInput !== undefined;
    const start = custom && Array.isArray(scheduleInput) ? scheduleInput[0]?.date : input?.start;
    const errors = {};
    if (!name || name.length > 60 || /[\r\n\t]/.test(name)) errors.name = '请输入 1–60 字的计划名称。';
    if (budget === null) errors.budget = '请输入不少于 ¥1,000 的整数预算，最高 ¥9,007,199,254,740,991。';
    if (!custom && !isDate(start)) errors.start = '请输入有效起始日期。';
    if (Number.isNaN(price) || price === 0) errors.price = '请输入大于 0、不超过 ¥1,000,000 的单价，至多两位小数。';
    if (Number.isNaN(fee)) errors.fee = '请输入 0–100% 的费率，至多两位小数。';
    if (Number.isNaN(fixedFee)) errors.fixedFee = '请输入 0–1,000,000 元的单批固定费用，至多两位小数。';
    if (!Object.hasOwn(model.horizons, input?.horizon) || !Object.hasOwn(model.risks, input?.risk)) {
      errors.settings = '请选择持有周期和分批比例。';
    }
    if (Object.keys(errors).length) return { errors, value: null };
    const { schedule = null, error } = custom ? normalizeSchedule(scheduleInput, budget) : {};
    if (error) return { errors: { schedule: error }, value: null };
    const quote = input.quote && cleanLabel(input.quote.name, 60) && isTimestamp(input.quote.quotedAt)
      ? { name: cleanLabel(input.quote.name, 60), quotedAt: input.quote.quotedAt } : null;
    const value = { name, budget, start: schedule ? schedule.map(({ date }) => date).sort()[0] : start, price, fee, fixedFee,
      horizon: input.horizon, risk: input.risk, schedule, quote };
    if (fixedFee && (schedule ?? presetSchedule(value)).some(({ amount }) => amount <= fixedFee)) {
      errors.fixedFee = '每批固定费用须低于所有单批预算。可调整费用或预算。';
      return { errors, value: null };
    }
    return { errors, value };
  }

  function estimate(input) {
    const { budget, horizon, risk } = input;
    const rows = input.schedule
      ? input.schedule.slice().sort((a, b) => a.date.localeCompare(b.date)).map((row) => ({ ...row, weight: row.amount / budget * 100 }))
      : presetSchedule(input);
    const stages = rows.map((stage) => {
      const net = (stage.amount - (input.fixedFee ?? 0)) / (1 + input.fee / 100);
      return { ...stage, fee: stage.amount - net,
        grams: input.price === null ? null : net / input.price };
    });
    return { budget, horizon, risk, stages, fee: stages.reduce((sum, stage) => sum + stage.fee, 0),
      grams: input.price === null ? null : stages.reduce((sum, stage) => sum + stage.grams, 0) };
  }

  function validatePurchase(input) {
    const date = input?.date;
    const paid = decimal(input?.paid, 1000000000);
    const grams = decimal(input?.grams, 1000000, 4);
    const errors = {};
    if (!isDate(date)) errors.date = '请输入有效的买入日期。';
    if (!paid) errors.paid = '请输入大于 0、不超过 ¥10 亿的实付金额，至多两位小数。';
    if (!grams) errors.grams = '请输入大于 0、不超过 100 万的克数，至多四位小数。';
    const note = cleanLabel(input?.note, 80);
    if (input?.note && !note && String(input.note).trim()) errors.note = '备注最多 80 字，请使用单行文字。';
    return { errors, value: Object.keys(errors).length ? null : { date, paid, grams, note } };
  }

  function purchaseProgress(budget, purchases = []) {
    const recorded = purchases.filter(Boolean);
    const spent = recorded.reduce((cents, item) => cents + Math.round(item.paid * 100), 0) / 100;
    const grams = recorded.reduce((units, item) => units + Math.round(item.grams * 10000), 0) / 10000;
    return { count: recorded.length, spent, grams, remaining: budget - spent, average: grams ? spent / grams : null };
  }

  function normalizeRecord(raw) {
    const { value } = validate(raw);
    if (!value || !isId(raw.id) || !isTimestamp(raw.updatedAt)) {
      throw Error('Invalid plan');
    }
    let trades = raw.trades;
    if (trades === undefined) {
      const legacy = raw.purchases ?? [null, null, null];
      if (!Array.isArray(legacy) || legacy.length !== 3) throw Error('Invalid legacy records');
      trades = legacy.flatMap((entry, index) => entry === null ? []
        : [{ ...entry, id: 'legacy-' + (index + 1), batchId: 'batch-' + (index + 1) }]);
    }
    if (!Array.isArray(trades) || trades.length > maxTrades) throw Error('Invalid trade list');
    const batches = new Set((value.schedule ?? presetSchedule(value)).map(({ id }) => id));
    const ids = new Set();
    const normalizedTrades = trades.map((entry) => {
      const trade = validatePurchase(entry).value;
      if (!trade || !isId(entry.id) || ids.has(entry.id) || !batches.has(entry.batchId)) throw Error('Invalid trade');
      ids.add(entry.id);
      return { ...trade, id: entry.id, batchId: entry.batchId };
    });
    return { ...value, id: raw.id, updatedAt: raw.updatedAt, trades: normalizedTrades };
  }

  function decodeBackup(text) {
    const data = JSON.parse(text);
    if (data?.format !== backupFormat || ![1, 2, 3].includes(data.version) || !Array.isArray(data.plans)) throw Error('Invalid backup');
    return data.plans.map(normalizeRecord);
  }

  function encodeBackup(records) {
    return JSON.stringify({ format: backupFormat, version: 3, plans: records }, null, 2);
  }

  function mergeRecords(existing, incoming, makeId) {
    const entries = new Map(existing.map((record) => [record.id, record]));
    for (const incomingPlan of incoming) {
      let plan = incomingPlan;
      const match = entries.get(plan.id);
      if (match) {
        const same = (saved) => {
          const { id, ...data } = saved;
          const { id: incomingId, ...incomingData } = plan;
          return JSON.stringify(data) === JSON.stringify(incomingData);
        };
        if (Array.from(entries.values()).some(same)) continue;
        plan = { ...plan, id: makeId() };
      }
      entries.set(plan.id, plan);
    }
    return Array.from(entries.values());
  }

  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }

  function planCsv(input, result) {
    const headers = ['行类型', '计划', '批次', '安排日期', '预算(CNY)', '比例(%)', '预估费用(CNY)', '预估克数', '成交日期', '实际支付(CNY)', '实际克数', '备注'];
    const rows = result.stages.flatMap((stage, index) => {
      const entries = input.trades?.filter((trade) => trade.batchId === stage.id) ?? [];
      return [
        ['预算', input.name, index + 1, stage.date, stage.amount, stage.weight.toFixed(2), stage.fee.toFixed(2), stage.grams?.toFixed(4)],
        ...entries.sort((a, b) => a.date.localeCompare(b.date)).map((trade) =>
          ['成交', input.name, index + 1, stage.date, '', '', '', '', trade.date, trade.paid.toFixed(2), trade.grams, trade.note]),
      ];
    });
    return '\ufeff' + [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  }

  function priceComparison(grams, offer) {
    const amount = decimal(grams, 1000000);
    const buy = decimal(offer.buy, 1000000);
    const fixed = decimal(offer.fixed, 1000000) ?? 0;
    const buyRate = decimal(offer.buyRate, 100) ?? 0;
    const sell = decimal(offer.sell, 1000000);
    const sellRate = decimal(offer.sellRate, 99.99) ?? 0;
    const errors = {};
    if (!amount) errors.grams = '请输入 0.01–1,000,000 克，最多两位小数。';
    if (buy === 0 || Number.isNaN(buy)) errors.buy = '请输入有效买入单价。';
    if (sell === 0 || Number.isNaN(sell)) errors.sell = '请输入有效回购单价。';
    if (Number.isNaN(fixed)) errors.fixed = '请输入 0–1,000,000 元。';
    if (Number.isNaN(buyRate)) errors.buyRate = '请输入 0–100% 的买入费率。';
    if (Number.isNaN(sellRate)) errors.sellRate = '请输入 0–99.99% 的回购费率。';
    if (Object.keys(errors).length || buy === null) return { errors, result: null };

    const total = amount * buy * (1 + buyRate / 100) + fixed;
    const sellFactor = 1 - sellRate / 100;
    const netSale = sell === null ? null : amount * sell * sellFactor;
    return { errors, quantity: amount, offer: { buy, sell, fixed, buyRate, sellRate },
      pricing: { price: buy, fee: buyRate, fixedFee: fixed }, result: {
      total, unit: total / amount, breakEven: total / amount / sellFactor,
      netSale, difference: netSale === null ? null : netSale - total,
    } };
  }

  function calendarText(value) {
    return value.replaceAll('\\', '\\\\').replace(/\r\n|\n|\r/g, '\\n').replace(/[,;]/g, '\\$&');
  }

  function foldCalendarLine(line) {
    const encoder = new TextEncoder();
    const parts = [];
    let current = '';
    let bytes = 0;
    for (const character of line) {
      const length = encoder.encode(character).length;
      if (bytes + length > 75) {
        parts.push(current);
        current = ' ';
        bytes = 1;
      }
      current += character;
      bytes += length;
    }
    parts.push(current);
    return parts.join('\r\n');
  }

  function planCalendar(input, id, timestamp = new Date()) {
    const dateStamp = timestamp.toISOString().replace(/[-:]|\.\d{3}/g, '');
    const header = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Aurelia//Gold Plan//ZH-CN', 'CALSCALE:GREGORIAN'];
    const events = estimate(input).stages.flatMap((stage, index) => [
      'BEGIN:VEVENT',
      'UID:' + id + '-' + (/^batch-[1-3]$/.test(stage.id) ? Number(stage.id.slice(6)) - 1 : stage.id) + '@aurelia.local',
      'DTSTAMP:' + dateStamp,
      'DTSTART;VALUE=DATE:' + stage.date.replaceAll('-', ''),
      'SUMMARY:' + calendarText(input.name + (input.schedule ? ' · 第' + (index + 1) + '批安排'
        : index ? ' · 第' + (index + 1) + '批复盘' : ' · 计划起点')),
      'DESCRIPTION:' + calendarText('分批预算人民币 ' + stage.amount + ' 元。请在复盘时核对渠道报价与费用。'),
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    ]);
    return [...header, ...events, 'END:VCALENDAR'].map(foldCalendarLine).join('\r\n') + '\r\n';
  }

  return { storageKey, previousStorageKeys, maxBatches, maxTrades, today, validate, estimate, presetSchedule, isId, isTimestamp,
    cleanLabel, validatePurchase, purchaseProgress, normalizeRecord, encodeBackup, decodeBackup, mergeRecords, planCsv,
    priceComparison, planCalendar };
})();

if (typeof module === 'object' && module.exports) module.exports = aureliaPlans;
