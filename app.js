'use strict';

{
const $ = (selector) => document.querySelector(selector);
const all = (selector) => [...document.querySelectorAll(selector)];
const setText = (selector, text) => {
  const target = $(selector);
  if (target.textContent !== text) target.textContent = text;
};
const integer = new Intl.NumberFormat('en-US');
const decimal = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = new Intl.NumberFormat('en-US', { signDisplay: 'exceptZero', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' });
const dollars = (value) => '$' + decimal.format(value);
const yuan = (value) => '¥' + decimal.format(value);
const percent = (value) => signed.format(value) + '%';
const absolutePercent = (value) => decimal.format(value) + '%';
const showValue = (value, format) => Number.isFinite(value) ? format(value) : '—';

const pages = {
  overview: ['黄金市场总览', '查看国际金价、人民币克价及国内报价入口。'],
  analysis: ['市场分析', '用美元或人民币查看历史区间，并对照样本外表现。'],
  plan: ['购买计划', '比较渠道成本，拆分预算并安排复盘。'],
};

function route(focusHeading) {
  const requested = location.hash.slice(2);
  const compare = requested === 'plan/compare';
  const page = compare ? 'plan' : location.hash.startsWith('#/') && Object.hasOwn(pages, requested) ? requested : 'overview';
  const [title, description] = pages[page];

  all('[data-page]').forEach((section) => { section.hidden = section.dataset.page !== page; });
  all('.primary-nav a').forEach((link) => {
    if (link.hash === '#/' + page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  setText('#page-title', title);
  setText('#page-description', description);
  document.title = title + ' · Aurelia';
  if (page === 'overview') spotChart.redraw();
  if (page === 'analysis') forecastChart.redraw();

  if (compare) {
    $('#compare-title').focus({ preventScroll: true });
    $('#quote-compare').scrollIntoView({ block: 'start' });
  } else if (focusHeading) {
    $('#page-title').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}

$('.skip-link').addEventListener('click', (event) => {
  event.preventDefault();
  $('#page-title').focus();
});
window.addEventListener('hashchange', () => route(true));

const chartColor = {
  ink: '#61685e', grid: '#e8e7de', actual: '#49745c', projected: '#946b36',
  band: 'rgba(198, 160, 92, .21)', cursor: '#819388', background: '#fffdf8',
};

function chart(canvas, tooltip) {
  const plot = canvas.parentElement;
  const context = canvas.getContext('2d');
  let data;
  let geometry;
  let selected;
  let tooltipActive = false;

  function path(points, x, y) {
    points.forEach((point, index) => {
      const px = x(point.x);
      const py = y(point.y);
      if (index === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    });
  }

  function draw() {
    const { width, height } = plot.getBoundingClientRect();
    if (!context || !data || width < 1 || height < 1) return;

    const density = Math.min(window.devicePixelRatio || 1, 3);
    const pixelWidth = Math.round(width * density);
    const pixelHeight = Math.round(height * density);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
    context.clearRect(0, 0, width, height);

    const { actual, projected, low, high, ticks } = data;
    const values = [...actual, ...low, ...high].map(({ y }) => y);
    const lowest = Math.min(...values);
    const highest = Math.max(...values);
    const span = Math.max(highest - lowest, 1);
    const magnitude = 10 ** Math.floor(Math.log10(span / 4));
    const step = magnitude * [1, 2, 2.5, 5, 10].find((size) => span / (magnitude * size) <= 4);
    const lower = Math.floor((lowest - step * 0.1) / step) * step;
    const upper = Math.ceil((highest + step * 0.1) / step) * step;
    const bounds = { left: step < 1 ? 58 : 43, right: width - 9, top: 12, bottom: height - 29 };
    const x = (value) => bounds.left + (value - ticks[0].value) / (ticks.at(-1).value - ticks[0].value) * (bounds.right - bounds.left);
    const y = (value) => bounds.top + (upper - value) / (upper - lower) * (bounds.bottom - bounds.top);
    geometry = { x, y, bounds };

    context.lineWidth = 1;
    context.font = '12px system-ui, sans-serif';
    context.strokeStyle = chartColor.grid;
    context.fillStyle = chartColor.ink;
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    for (let price = lower; price <= upper; price += step) {
      const py = y(price);
      context.beginPath();
      context.moveTo(bounds.left, py);
      context.lineTo(bounds.right, py);
      context.stroke();
      context.fillText(step < 1 ? decimal.format(price) : integer.format(price), 0, py);
    }

    context.textBaseline = 'top';
    const shownTicks = width < 315 ? ticks.filter((_, index) => index % 2 === 0) : ticks;
    shownTicks.forEach((tick, index) => {
      context.textAlign = index === 0 ? 'left' : index === shownTicks.length - 1 ? 'right' : 'center';
      context.fillText(tick.label, x(tick.value), bounds.bottom + 10);
    });

    if (projected.length) {
      context.beginPath();
      context.moveTo(x(0), bounds.top);
      context.lineTo(x(0), bounds.bottom);
      context.stroke();
      context.beginPath();
      path(high, x, y);
      low.slice().reverse().forEach((point) => context.lineTo(x(point.x), y(point.y)));
      context.closePath();
      context.fillStyle = chartColor.band;
    } else {
      const gradient = context.createLinearGradient(0, bounds.top, 0, bounds.bottom);
      gradient.addColorStop(0, 'rgba(105, 146, 116, .19)');
      gradient.addColorStop(1, 'rgba(105, 146, 116, .01)');
      context.beginPath();
      path(actual, x, y);
      context.lineTo(x(actual.at(-1).x), bounds.bottom);
      context.lineTo(bounds.left, bounds.bottom);
      context.closePath();
      context.fillStyle = gradient;
    }
    context.fill();

    context.lineWidth = 2;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.strokeStyle = chartColor.actual;
    context.beginPath();
    path(actual, x, y);
    context.stroke();
    if (projected.length) {
      context.strokeStyle = chartColor.projected;
      context.setLineDash([5, 5]);
      context.beginPath();
      path(projected, x, y);
      context.stroke();
      context.setLineDash([]);
    }

    const marker = selected ?? actual.at(-1);
    if (selected) {
      context.beginPath();
      context.strokeStyle = chartColor.cursor;
      context.lineWidth = 1;
      context.moveTo(x(marker.x), bounds.top);
      context.lineTo(x(marker.x), bounds.bottom);
      context.stroke();
    }
    context.beginPath();
    context.arc(x(marker.x), y(marker.y), 4, 0, 2 * Math.PI);
    context.fillStyle = marker.x > 0 && projected.length ? chartColor.projected : chartColor.actual;
    context.fill();
    context.strokeStyle = chartColor.background;
    context.lineWidth = 1.5;
    context.stroke();
  }

  function clearTooltip() {
    tooltipActive = false;
    selected = null;
    tooltip.hidden = true;
    draw();
  }

  function showTooltip(event) {
    if (!data || !geometry) return;
    const rect = canvas.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const candidates = [...data.actual, ...data.projected.slice(1)];
    const nearest = candidates.reduce((closest, point) => (
      Math.abs(geometry.x(point.x) - pointerX) < Math.abs(geometry.x(closest.x) - pointerX) ? point : closest
    ));
    if (tooltipActive && selected === nearest) return;
    selected = nearest;
    tooltipActive = true;
    tooltip.textContent = data.label(selected.x) + ' · ' + (data.format ?? dollars)(selected.y);
    tooltip.hidden = false;
    const left = Math.min(rect.width - tooltip.offsetWidth, Math.max(0, geometry.x(selected.x) - tooltip.offsetWidth / 2));
    const top = Math.max(0, geometry.y(selected.y) - tooltip.offsetHeight - 10);
    tooltip.style.transform = `translate(${left}px, ${top}px)`;
    draw();
  }

  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'touch') showTooltip(event);
  });
  canvas.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'touch' && tooltipActive) clearTooltip();
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch') showTooltip(event);
  });
  canvas.addEventListener('pointercancel', clearTooltip);
  document.addEventListener('pointerdown', (event) => {
    if (tooltipActive && !plot.contains(event.target)) clearTooltip();
  });
  new ResizeObserver(() => {
    if (tooltipActive) clearTooltip();
    else draw();
  }).observe(plot);
  return {
    update(next) {
      data = next;
      clearTooltip();
    },
    redraw: clearTooltip,
  };
}

function renderTable(target, headings, rows) {
  $(target).innerHTML = `<table><thead><tr>${headings.map((title) => `<th scope="col">${title}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(([label, ...values]) => `<tr><th scope="row">${label}</th>${values.map((value) => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

const spotChart = chart($('#spot-chart'), $('.spot-plot .chart-tooltip'));
const forecastChart = chart($('#forecast-chart'), $('.forecast-plot .chart-tooltip'));
const { getReference, convertHistory, createStore, indicators, scenario, percentChange } = aureliaMarket;
let latestRows;
let latestRates;
let yuanRows = [];
const results = new Map();

function spotSeries(rows) {
  $('#spot-figure').hidden = !rows.length;
  $('#quote-chart-empty').hidden = Boolean(rows.length);
  if (!rows.length) return;
  const isCny = $('input[name="spot-currency"]:checked').value === 'cny';
  const range = Number($('input[name="spot-range"]:checked').value);
  const series = (isCny ? yuanRows : rows).slice(-range);
  const hasData = series.length > 1;
  $('#spot-unit-empty').hidden = hasData;
  $('#spot-series').hidden = !hasData;
  setText('#spot-range-label', hasData ? series.length + ' 个观测日' : '');
  if (!hasData) {
    setText('#spot-unit-empty', '同日汇率数据不足。可以切换到美元查看。');
    return;
  }
  const format = isCny ? yuan : dollars;
  const actual = series.map((point, index) => ({ x: index, y: point.price }));
  const end = series.length - 1;
  const label = (index) => series[index].date;
  const ticks = [...new Set([0, 0.25, 0.5, 0.75, 1].map((part) => Math.round(end * part)))]
    .map((value) => ({ value, label: label(value).slice(5) }));
  const change = percentChange(series.at(-1).price, series[0].price);
  setText('#spot-range-label', series.length + ' 个观测日 · ' + percent(change));
  setText('#spot-series-note', isCny ? '波兰央行日度金价 × 同日 ECB 汇率 ÷ 31.1034768，缺少同日汇率的日期略过。' : '波兰央行日度参考价 · 美元 / 金衡盎司');
  spotChart.update({ actual, projected: [], low: [], high: [], ticks, label, format });
  renderTable('#spot-data', ['日期', isCny ? '人民币 / 克' : '美元 / 金衡盎司'], series.slice().reverse().map(({ date, price }) => [date, format(price)]));
}

function renderIndicators(rows) {
  const values = indicators(rows);
  setText('#trend-label', !values ? '样本待就绪' : values.monthly > 0 ? '阶段上涨' : values.monthly < 0 ? '阶段下跌' : '阶段持平');
  setText('#trend-return', showValue(values?.monthly, percent));
  setText('#trend-week', showValue(values?.weekly, percent));
  setText('#trend-volatility', showValue(values?.volatility, absolutePercent));
  setText('#factor-week', showValue(values?.weekly, percent));
  setText('#factor-month', showValue(values?.monthly, percent));
  setText('#factor-average', showValue(values?.deviation, percent));
  setText('#factor-volatility', showValue(values?.volatility, absolutePercent));
  if (values) setText('#factor-average-note', '60 个观测日均价 ' + dollars(values.average60) + ' / oz。');
}

function renderScenario(state) {
  const period = Number($('input[name="period"]:checked').value);
  const currency = $('input[name="analysis-currency"]:checked').value;
  const isCny = currency === 'cny';
  const rows = isCny ? yuanRows : latestRows ?? emptyHistory;
  const historyError = state.history.error || (isCny && state.fxHistory.error);
  const format = isCny ? yuan : dollars;
  const key = currency + '-' + period;
  if (!results.has(key)) results.set(key, scenario(rows, period));
  const result = results.get(key);
  const dataDate = rows.at(-1)?.date;
  const sourceName = isCny ? '波兰央行日度金价与同日 ECB 汇率' : '波兰央行日度参考价';
  setText('#analysis-source', sourceName + (dataDate ? ' · 截至 ' + dataDate : '')
    + (historyError && dataDate ? ' · 使用缓存' : '') + ' · 按观测日计');
  $('#analysis-result').hidden = !result;
  $('#analysis-empty').hidden = Boolean(result);
  setText('#analysis-empty', rows.length
    ? '需要至少 ' + (252 + period) + ' 个历史观测值。'
    : historyError ? '暂时无法获取所选币种的历史数据。可切换币种或返回总览刷新。' : '正在读取历史数据。');

  const validation = result?.validation;
  $('#validation-metrics').hidden = !validation;
  $('#validation-reading').hidden = !validation;
  $('#validation-empty').hidden = Boolean(validation);
  setText('#validation-empty', rows.length ? '现有历史数据不足以生成样本外结果。' : '历史数据就绪后显示结果。');
  if (!result) return;
  const { anchor, low, median, high } = result;
  setText('#scenario-unit', '历史中位情景 · ' + (isCny ? '人民币 / 克' : '美元 / 盎司'));
  setText('#forecast-value', format(median));
  setText('#forecast-range', format(low) + ' – ' + format(high));
  setText('#forecast-change', '较参考价 ' + percent(percentChange(median, anchor.price)));
  if (validation) {
    setText('#validation-period', validation.startDate + ' 至 ' + validation.endDate);
    setText('#validation-coverage', absolutePercent(validation.coverage));
    setText('#validation-mape', absolutePercent(validation.mape));
    setText('#validation-baseline', absolutePercent(validation.baselineMape));
    setText('#validation-count', String(validation.samples));
    const modelError = decimal.format(validation.mape);
    const flatError = decimal.format(validation.baselineMape);
    setText('#validation-reading', modelError === flatError ? '按两位小数显示，中位情景与持平基准的误差相同。'
      : '历史检验中，中位情景的误差' + (validation.mape < validation.baselineMape ? '低于' : '高于') + '持平基准。');
  }

  const series = rows.slice(-31);
  const end = series.length - 1;
  const actual = series.map((entry, index) => ({ x: index - end, y: entry.price }));
  const start = { x: 0, y: anchor.price };
  const label = (x) => x > 0 ? '+' + x + ' 观测日' : series[x + end].date;
  const ticks = [-end, -Math.round(end / 2), 0, Math.round(period / 2), period].map((value) => ({
    value, label: value > 0 ? '+' + value + ' 日' : label(value).slice(5),
  }));
  forecastChart.update({
    actual, projected: [start, { x: period, y: median }],
    low: [start, { x: period, y: low }], high: [start, { x: period, y: high }],
    ticks, label, format,
  });
  renderTable('#forecast-data', ['日期 / 期限', '参考价 / 中位', '下限', '上限'], [
    ...series.map((entry) => [entry.date, format(entry.price), '—', '—']),
    [label(period), format(median), format(low), format(high)],
  ]);
}

function marketStorage() {
  try { return window.localStorage; } catch { return null; }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw Error('Market data request failed');
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function renderMarket(state) {
  const reference = getReference(state, Date.now());
  const { source, value, date, recentQuote, close, quote, fx, fxSource, cny } = reference;
  const rows = state.history.value ?? emptyHistory;
  const rates = state.fxHistory.value ?? emptyHistory;
  const noData = !Number.isFinite(value);
  const failed = Object.values(state).some((entry) => entry.error);
  const selected = source === 'quote' ? state.quote : state.history;
  const dateLabel = source === 'quote' && quote ? dateTime.format(quote.time) : date;
  const cached = selected.error;
  const offline = navigator.onLine === false;
  const checkedAt = selected?.checkedAt;
  const checkedLabel = Number.isFinite(checkedAt) ? dateTime.format(checkedAt) : '';

  $('#market-status').dataset.state = noData ? 'pending' : offline || cached ? 'offline' : recentQuote ? 'current' : 'reference';
  setText('#market-status span', noData ? offline ? '离线，暂无行情' : failed ? '行情暂不可用' : '正在读取行情'
    : offline ? '离线 · 使用缓存' : cached ? '使用缓存' : source === 'history' ? '日度参考' : recentQuote ? '报价已更新' : '最近报价');
  setText('#quote-title', noData ? '国际黄金参考价' : source === 'quote' ? '国际现货报价' : '国际日度参考价');
  setText('#spot', showValue(value, dollars));
  setText('#quote-source', noData ? failed ? '行情暂不可用，请稍后刷新。' : '正在读取现货报价与日度数据。' :
    (source === 'quote' ? 'Gold API · ' : '波兰央行日度参考 · ') + dateLabel
      + (cached ? ' · 缓存' : '') + (source === 'quote' && !recentQuote ? ' · 报价非最新' : ''));
  setText('#spot-cny', showValue(cny, yuan));
  setText('#reference-close', showValue(close?.price, dollars));
  setText('#reference-change', rows.length >= 2 ? percent(percentChange(close.price, rows.at(-2).price)) : '—');
  setText('#fx-source', cny ? 'ECB 日度汇率 · ' + fx.date + ' · 1 USD ≈ ' + fx.rate + ' CNY'
    + (state[fxSource].error ? ' · 缓存' : '') : '人民币换算等待可用的 ECB 参考汇率。');
  setText('#quote-chart-empty', state.history.error ? '近期走势暂不可用。' : '正在读取近期走势。');
  setText('#data-freshness', noData ? offline ? '当前处于离线状态，连接恢复后可重新读取行情。' : '等待可用数据。'
    : offline ? '离线查看 · 最近一次读取 ' + checkedLabel
    : cached ? '数据源暂时不可用 · 正在使用最近一次有效数据' + (checkedLabel ? ' · 读取于 ' + checkedLabel : '')
    : checkedLabel ? '数据读取于 ' + checkedLabel + ' · 页面可见时自动检查更新' : '页面可见时自动检查更新');

  const referenceUsable = cny && date && Date.parse(date) >= Date.now() - 7 * 86400000;
  planner.setReference(referenceUsable ? { cny, date } : null);
  const changed = rows !== latestRows || rates !== latestRates;
  if (changed) {
    yuanRows = convertHistory(rows, rates);
    spotSeries(rows);
    latestRates = rates;
    results.clear();
  }
  if (rows !== latestRows) {
    latestRows = rows;
    renderIndicators(rows);
  }
  const scenarioStatus = String(state.history.error) + String(state.fxHistory.error);
  if (changed || scenarioStatus !== lastScenarioStatus) {
    lastScenarioStatus = scenarioStatus;
    renderScenario(state);
  }
}

const emptyHistory = [];
let lastScenarioStatus;
const planner = mountAureliaPlanner();
const store = createStore({ storage: marketStorage(), fetchJson, onChange: renderMarket });
for (const selector of ['#period-switch', '#analysis-currency-switch']) {
  $(selector).addEventListener('change', () => renderScenario(store.state));
}
for (const selector of ['#spot-range-switch', '#spot-currency-switch']) {
  $(selector).addEventListener('change', () => spotSeries(latestRows ?? emptyHistory));
}

$('#market-refresh').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  setText('#refresh-status', '正在刷新行情。');
  await store.refresh(true);
  button.disabled = false;
  const failed = Object.values(store.state).filter((entry) => entry.error).length;
  setText('#refresh-status', failed ? '部分数据暂未更新，已保留可用数据。' : '行情已检查。');
});

route(false);
renderMarket(store.state);
void store.refresh();
setInterval(() => {
  if (!document.hidden) {
    renderMarket(store.state);
    void store.refresh();
  }
}, 60000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    renderMarket(store.state);
    void store.refresh();
  }
});
window.addEventListener('online', () => {
  renderMarket(store.state);
  void store.refresh(true);
});
window.addEventListener('offline', () => renderMarket(store.state));

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
}
