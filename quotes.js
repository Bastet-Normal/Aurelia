'use strict';

const aureliaQuotes = (() => {
  const plans = typeof module === 'object' && module.exports ? require('./plans.js') : aureliaPlans;
  const { cleanLabel, isId, isTimestamp, priceComparison } = plans;
  const storageKey = 'aurelia-quotes-v1';

  function normalize(raw) {
    const name = cleanLabel(raw?.name, 60);
    const { result, offer, quantity } = raw?.offer ? priceComparison(raw.quantity, raw.offer) : {};
    if (!name || !isId(raw?.id) || !isTimestamp(raw.quotedAt) || !result) throw Error('Invalid quote');
    return { id: raw.id, name, quotedAt: raw.quotedAt, quantity, offer };
  }

  function encode(quotes) {
    return JSON.stringify({ format: 'aurelia.quotes', version: 1, quotes }, null, 2);
  }

  function decode(text) {
    const data = JSON.parse(text);
    if (data?.format !== 'aurelia.quotes' || data.version !== 1 || !Array.isArray(data.quotes)) throw Error('Invalid backup');
    return data.quotes.map(normalize);
  }

  function channelKey(name) {
    return name.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
  }

  function mostRecent(quotes, name) {
    const key = channelKey(name);
    return quotes.reduce((latest, quote) => channelKey(quote.name) === key && (!latest || quote.quotedAt > latest.quotedAt)
      ? quote : latest, null);
  }

  function difference(quantity, current, previous) {
    return priceComparison(quantity, current).result.total - priceComparison(quantity, previous).result.total;
  }

  function previousById(sorted) {
    const previous = new Map();
    const channels = new Map();
    for (const quote of sorted.slice().reverse()) {
      const key = channelKey(quote.name);
      if (channels.has(key)) previous.set(quote.id, channels.get(key));
      channels.set(key, quote);
    }
    return previous;
  }

  return { storageKey, normalize, encode, decode, channelKey, mostRecent, difference, previousById };
})();

if (typeof module === 'object' && module.exports) module.exports = aureliaQuotes;

function mountAureliaComparison({ applyQuote, download, makeId, jumpTo }) {
  const { storageKey, normalize, encode, decode, channelKey, mostRecent, difference, previousById } = aureliaQuotes;
  const { cleanLabel, isTimestamp, mergeRecords, priceComparison, today } = aureliaPlans;
  const pick = (selector) => document.querySelector(selector);
  const setText = (selector, text) => { if (pick(selector).textContent !== text) pick(selector).textContent = text; };
  const amountText = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const clock = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
  const yuan = (value) => (value < 0 ? '−' : '') + '¥' + amountText.format(Math.abs(value));

  const comparison = pick('#comparison-form');
  const fileInput = pick('#quote-import-file');
  const quantityField = pick('#compare-grams');
  const filter = pick('#quote-filter');
  const sides = ['A', 'B'];
  const fields = [
    ['buy', '买入单价（¥/克）', '例如 780'],
    ['sell', '回购单价（¥/克，选填）', '例如 760'],
    ['fixed', '整笔工费或固定费（¥）', '0'],
    ['buyRate', '额外买入费率（%）', '0'],
    ['sellRate', '额外回购费率（%）', '0'],
  ];
  const field = (side, name) => comparison.elements.namedItem(side + '-' + name);
  const states = new Map();
  const loaded = new Map();
  let quotes = [];
  let usingMemory = false;
  let visibleCount = 12;

  function read() {
    const text = localStorage.getItem(storageKey);
    return text === null ? [] : mergeRecords([], decode(text), makeId);
  }

  function current() {
    if (!usingMemory) {
      try { return read(); } catch { /* Keep the data already loaded. */ }
    }
    return quotes;
  }

  function save(next) {
    quotes = next;
    try {
      localStorage.setItem(storageKey, encode(next));
      usingMemory = false;
    } catch {
      usingMemory = true;
    }
    renderComparison();
    renderLibrary();
    return !usingMemory;
  }

  function action(label, className, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }

  function reuse(quote, side) {
    loaded.set(side, quote);
    field(side, 'name').value = quote.name;
    field(side, 'time').value = '';
    for (const [name] of fields) field(side, name).value = quote.offer[name] ?? '';
    pick('#offer-' + side + ' details').open = Boolean(quote.offer.fixed || quote.offer.buyRate || quote.offer.sellRate);
    renderComparison();
    setText('#compare-' + side + '-status', '已载入 ' + clock.format(quote.quotedAt) + ' 的报价，保存时可指定新报价时间。');
    field(side, 'buy').focus({ preventScroll: true });
    pick('#offer-' + side).scrollIntoView({ block: 'start' });
  }

  function renderLibrary() {
    const sorted = quotes.slice().sort((a, b) => b.quotedAt - a.quotedAt);
    const latest = sorted[0];
    pick('#quote-recent').hidden = !latest;
    pick('#backup-quotes').disabled = !latest;
    filter.disabled = !latest;
    if (latest) setText('#recent-quote-label', latest.name + ' · ' + yuan(latest.offer.buy) + '/克 · ' + clock.format(latest.quotedAt));
    const query = channelKey(filter.value);
    const matched = sorted.filter((quote) => channelKey(quote.name).includes(query));
    const priorQuotes = previousById(sorted);
    pick('#quote-library-empty').hidden = Boolean(matched.length);
    pick('#more-quotes').hidden = matched.length <= visibleCount;
    setText('#quote-library-empty', sorted.length ? '没有匹配的渠道。' : '保存报价后可在这里复用。');
    pick('#quote-history').replaceChildren(...matched.slice(0, visibleCount).map((quote) => {
      const row = document.createElement('li');
      const info = document.createElement('div');
      const title = document.createElement('strong');
      const details = document.createElement('p');
      title.textContent = quote.name;
      const { offer } = quote;
      details.textContent = clock.format(quote.quotedAt) + ' · 买入 ' + yuan(offer.buy) + '/克'
        + (offer.sell === null ? '' : ' · 回购 ' + yuan(offer.sell) + '/克');
      const fees = document.createElement('p');
      fees.textContent = '买入费率 ' + offer.buyRate + '% · 固定费 ' + yuan(offer.fixed) + ' · 回购费率 ' + offer.sellRate + '%';
      info.append(title, details, fees);
      const prior = priorQuotes.get(quote.id);
      if (prior) {
        const change = difference(quote.quantity, quote.offer, prior.offer);
        const delta = document.createElement('p');
        delta.textContent = quote.quantity + ' 克含费总价较上一条'
          + (amountText.format(Math.abs(change)) === '0.00' ? '持平。' : (change < 0 ? '低 ' : '高 ') + yuan(Math.abs(change)) + '。');
        info.append(delta);
      }
      const controls = document.createElement('div');
      controls.className = 'library-actions';
      controls.append(
        action('载入 A', 'outline-button', () => reuse(quote, 'A')),
        action('载入 B', 'outline-button', () => reuse(quote, 'B')),
        action('删除', 'text-button remove-plan', () => {
          if (!window.confirm('删除「' + quote.name + '」这条报价？')) return;
          const saved = save(current().filter(({ id }) => id !== quote.id));
          setText('#quote-library-status', saved ? '报价已删除。' : '当前页面已更新报价，请下载备份。');
        }),
      );
      row.append(info, controls);
      return row;
    }));
  }

  function renderComparison() {
    const results = sides.map((side) => {
      const raw = Object.fromEntries(fields.map(([name]) => [name, field(side, name).value]));
      const name = cleanLabel(field(side, 'name').value, 60);
      const state = priceComparison(quantityField.value, raw);
      const { errors, result } = state;
      states.set(side, { ...state, name });
      quantityField.toggleAttribute('aria-invalid', Boolean(errors.grams));
      for (const [key] of fields) field(side, key).toggleAttribute('aria-invalid', Boolean(errors[key]));
      setText('#compare-' + side + '-status', fields.map(([key]) => errors[key]).find(Boolean) || '');
      const output = pick('#compare-' + side + '-results');
      output.hidden = !result;
      pick('#compare-' + side + '-actions').hidden = !result;
      const changes = pick('#compare-' + side + '-change');
      changes.hidden = true;
      if (!result) return { result, name, errors };
      const figures = [['买入总价', result.total], ['含费克价', result.unit], ['回购保本价 / 克', result.breakEven]];
      if (result.netSale !== null) figures.push(['回购净额', result.netSale], ['按此报价盈亏', result.difference]);
      output.innerHTML = figures.map(([label, value]) => '<div><dt>' + label + '</dt><dd>' + yuan(value) + '</dd></div>').join('');
      const previous = name && mostRecent(quotes, name);
      if (previous) {
        const change = difference(state.quantity, state.offer, previous.offer);
        changes.hidden = false;
        changes.textContent = '同克重较 ' + clock.format(previous.quotedAt) + ' 的含费总价'
          + (amountText.format(Math.abs(change)) === '0.00' ? '持平。' : (change < 0 ? '低 ' : '高 ') + yuan(Math.abs(change)) + '。');
      }
      return { result, name, errors };
    });
    const [first, second] = results;
    let summary = first.errors.grams || '填入渠道买入单价后显示含费成本。';
    if (first.result && second.result) {
      const delta = first.result.total - second.result.total;
      const cheaper = delta < 0 ? first.name || '渠道 A' : second.name || '渠道 B';
      summary = amountText.format(Math.abs(delta)) === '0.00' ? '两边买入总价相差不足 ¥0.01。'
        : cheaper + ' 的买入总价低 ' + yuan(Math.abs(delta)) + '。';
    }
    setText('#comparison-summary', summary);
  }

  function quoteTime(side, keepOriginal = false) {
    const timeField = field(side, 'time');
    const prior = loaded.get(side);
    const state = states.get(side);
    if (keepOriginal && !timeField.value && prior && channelKey(prior.name) === channelKey(state.name)
      && JSON.stringify(prior.offer) === JSON.stringify(state.offer)) return prior.quotedAt;
    const time = timeField.value ? new Date(timeField.value).getTime() : Date.now();
    if (isTimestamp(time) && time <= Date.now()) return time;
    pick('#offer-' + side + ' details').open = true;
    setText('#compare-' + side + '-status', '请输入有效的报价时间，或留空使用当前时间。');
    timeField.focus();
    return null;
  }

  for (const side of sides) {
    const settings = ([name, label, placeholder]) =>
      `<label class="form-field"><span>${label}</span><input name="${side}-${name}" inputmode="decimal" placeholder="${placeholder}" aria-describedby="compare-${side}-status"></label>`;
    comparison.insertAdjacentHTML('beforeend', `<fieldset class="offer" id="offer-${side}">
      <legend>渠道 ${side}</legend>
      <label class="form-field offer-name"><span>渠道名称</span><input name="${side}-name" maxlength="60" placeholder="报价来自哪里"></label>
      <div class="form-fields">${fields.slice(0, 2).map(settings).join('')}</div>
      <details class="method-note offer-fees"><summary>费用与报价时间</summary>
        <div class="form-fields">${fields.slice(2).map(settings).join('')}
          <label class="form-field quote-time"><span>报价时间（选填）</span><input type="datetime-local" name="${side}-time"></label>
        </div>
      </details>
      <p class="field-hint" id="compare-${side}-status" role="status"></p>
      <dl class="offer-results" id="compare-${side}-results" hidden></dl>
      <p class="quote-change" id="compare-${side}-change" hidden></p>
      <div class="offer-actions" id="compare-${side}-actions" hidden>
        <button type="button" class="primary-button" id="use-quote-${side}">用此报价做计划</button>
        <button type="button" class="outline-button" id="save-quote-${side}">保存报价</button>
      </div>
    </fieldset>`);
    pick('#use-quote-' + side).addEventListener('click', () => {
      const state = states.get(side);
      if (!state?.pricing) return;
      const quotedAt = quoteTime(side, true);
      if (quotedAt !== null) applyQuote(state.pricing, { name: state.name || '渠道 ' + side, quotedAt });
    });
    pick('#save-quote-' + side).addEventListener('click', () => {
      const state = states.get(side);
      if (!state?.result) return;
      const status = '#compare-' + side + '-status';
      if (!state.name) {
        setText(status, '填写渠道名称后即可保存。');
        field(side, 'name').focus();
        return;
      }
      const quotedAt = quoteTime(side);
      if (quotedAt === null) return;
      const quote = normalize({ ...state, quotedAt, id: makeId() });
      const existing = current();
      const duplicate = existing.some((item) => channelKey(item.name) === channelKey(quote.name)
        && Math.abs(item.quotedAt - quote.quotedAt) < 60000 && item.quantity === quote.quantity
        && JSON.stringify(item.offer) === JSON.stringify(quote.offer));
      if (duplicate) {
        setText(status, '这条报价已保存。');
        return;
      }
      setText(status, save([quote, ...existing]) ? '报价已保存。' : '报价已留在当前页面，请下载备份。');
    });
  }

  comparison.addEventListener('submit', (event) => event.preventDefault());
  comparison.addEventListener('input', renderComparison);
  quantityField.addEventListener('input', renderComparison);
  quantityField.setAttribute('aria-describedby', 'comparison-summary');
  filter.addEventListener('input', () => {
    visibleCount = 12;
    renderLibrary();
  });
  pick('#more-quotes').addEventListener('click', () => {
    visibleCount += 12;
    renderLibrary();
    pick('#quote-history li:nth-child(' + (visibleCount - 11) + ') button')?.focus({ preventScroll: true });
  });
  pick('#jump-to-quotes').addEventListener('click', () => jumpTo('#quote-library', '#quote-library-title'));
  pick('#backup-quotes').addEventListener('click', () => download('Aurelia-报价备份-' + today() + '.json',
    encode(current()), 'application/json;charset=utf-8'));
  pick('#import-quotes').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      if (file.size > 16 * 1024 * 1024) throw Error('Backup is too large');
      const incoming = decode(await file.text());
      const existing = current();
      const next = mergeRecords(existing, incoming, makeId);
      const count = next.length - existing.length;
      const saved = !count || save(next);
      setText('#quote-library-status', count ? '已导入 ' + count + ' 条报价。'
        + (saved ? '' : '请下载备份以便恢复。') : '没有需要新增的报价。');
    } catch {
      setText('#quote-library-status', '无法读取此文件，请选择 Aurelia 导出的报价备份。');
    } finally {
      fileInput.value = '';
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== storageKey || usingMemory) return;
    quotes = current();
    renderComparison();
    renderLibrary();
  });
  try { quotes = read(); } catch {
    setText('#quote-library-status', '无法读取已保存的报价，可从报价备份恢复。');
  }
  renderComparison();
  renderLibrary();
}
