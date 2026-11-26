'use strict';

function mountAureliaPlanner() {
  const { risks, horizons, restorePlan, defaultPlan, parseBudget, parseYuan } = aureliaModel;
  const { storageKey, previousStorageKeys, maxBatches, maxTrades, today, validate, estimate, presetSchedule,
    validatePurchase, purchaseProgress, normalizeRecord, encodeBackup, decodeBackup, mergeRecords, planCsv, planCalendar } = aureliaPlans;
  const $ = (selector) => document.querySelector(selector);
  const integer = new Intl.NumberFormat('en-US');
  const costs = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const grams = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
  const ratios = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const quoteDate = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
  const yuan = (value) => '¥' + integer.format(value);
  const preciseYuan = (value) => (value < 0 ? '−' : '') + '¥' + costs.format(Math.abs(value));
  const setText = (selector, value) => { if ($(selector).textContent !== value) $(selector).textContent = value; };

  const form = $('#plan-form');
  const input = form.elements;
  const fileInput = $('#plan-import-file');
  const dialog = $('#purchase-dialog');
  const purchaseForm = $('#purchase-form');
  const purchaseFields = purchaseForm.elements;
  const batchName = (index) => '第 ' + (index + 1) + ' 批';
  const scheduleLines = $('#schedule-lines');
  let activeId;
  let draftId;
  let reference;
  let records = [];
  let usingMemory = false;
  let hasDraft = false;
  let cleanSettings;
  let notice = '';
  let editingPurchase;
  let quoteContext;

  const makeId = () => 'p-' + (crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint32Array(4)), (number) => number.toString(16)).join('-'));

  function readRecords() {
    const saved = window.localStorage.getItem(storageKey);
    if (saved === null) return null;
    const parsed = decodeBackup(saved);
    return mergeRecords([], parsed, makeId);
  }

  function saveRecords(next) {
    records = next;
    try {
      window.localStorage.setItem(storageKey, encodeBackup(records));
      usingMemory = false;
      return true;
    } catch {
      usingMemory = true;
      return false;
    } finally {
      renderLibrary();
    }
  }

  function currentRecords() {
    if (!usingMemory) {
      try { return readRecords() ?? records; } catch { /* Keep the records already loaded. */ }
    }
    return records;
  }

  function defaults() {
    return { ...defaultPlan, budget: '', name: '黄金分批计划', start: today(), price: null, fee: 0, fixedFee: 0 };
  }

  function restore() {
    try {
      const existing = readRecords();
      if (existing) return existing;
      for (const key of previousStorageKeys) {
        const previous = window.localStorage.getItem(key);
        if (previous === null) continue;
        const migrated = mergeRecords([], decodeBackup(previous), makeId);
        if (!saveRecords(migrated)) notice = '已读取旧计划，请下载备份，浏览器未能保存迁移结果。';
        return migrated;
      }
      const newest = window.localStorage.getItem('aurelia-plan-v1');
      const old = newest ? JSON.parse(newest) : {
        budget: window.localStorage.getItem('aurelia-budget'),
        risk: window.localStorage.getItem('aurelia-risk'),
      };
      if (old?.budget || old?.risk) {
        const migrated = normalizeRecord({ ...defaults(), ...restorePlan(old), name: '旧版计划', id: makeId(), updatedAt: Date.now() });
        saveRecords([migrated]);
        return [migrated];
      }
    } catch {
      notice = '无法读取原有计划。可从备份恢复，当前内容可先保留在这一页。';
    }
    return [];
  }

  function renderChoices(target, name, options) {
    $(target).innerHTML = Object.entries(options).map(([key, { title, weights }]) => `
      <label class="choice">
        <input type="radio" name="${name}" value="${key}" required>
        <span><strong>${title}</strong>${weights ? `<small>${weights.join(' / ')}%</small>` : ''}</span>
      </label>`).join('');
  }

  function formValue() {
    return { ...Object.fromEntries(new FormData(form)), quote: quoteContext,
      schedule: input.mode.value === 'custom' ? readSchedule() : null };
  }

  function formFingerprint() {
    return JSON.stringify(formValue());
  }

  function fill(record) {
    $('#plan-stages').replaceChildren();
    activeId = record.id;
    draftId = record.id ?? makeId();
    input.name.value = record.name;
    input.start.value = record.start;
    quoteContext = record.quote ?? null;
    input.budget.value = record.budget === '' ? '' : integer.format(record.budget);
    input.horizon.value = record.horizon;
    input.risk.value = record.risk;
    input.price.value = record.price ?? '';
    input.fee.value = record.fee || '';
    input.fixedFee.value = record.fixedFee || '';
    input.mode.value = record.schedule ? 'custom' : 'preset';
    renderSchedule(record.schedule ?? []);
    showScheduleMode();
    $('#plan-estimate-fields').open = Boolean(record.price || record.fee || record.fixedFee);
    renderQuoteContext();
    cleanSettings = formFingerprint();
    hasDraft = false;
    clearErrors();
    setText('#save-status', '');
    setText('#purchase-status', '');
    renderCurrentPlan();
    renderLibrary();
  }

  function activeRecord() {
    return records.find((record) => record.id === activeId);
  }

  function readSchedule() {
    return [...scheduleLines.children].map((row) => ({
      id: row.dataset.batch,
      date: row.querySelector('[data-date]').value,
      amount: row.querySelector('[data-amount]').value,
    }));
  }

  function renderSchedule(rows) {
    const booked = new Set(activeRecord()?.trades.map(({ batchId }) => batchId));
    scheduleLines.innerHTML = rows.map(({ id }, index) => `
      <fieldset class="schedule-line" data-batch="${id}">
        <legend>${batchName(index)}</legend>
        <label class="form-field"><span>安排日期</span><input type="date" data-date aria-label="${batchName(index)}安排日期" min="1900-01-01" max="9998-12-31"></label>
        <label class="form-field"><span>金额（¥）</span><input inputmode="numeric" data-amount aria-label="${batchName(index)}金额"></label>
        <button type="button" class="text-button" data-remove-batch ${rows.length === 1 || booked.has(id) ? 'disabled' : ''}
          aria-label="移除${batchName(index)}">移除</button>
      </fieldset>`).join('');
    rows.forEach(({ date, amount }, index) => {
      const row = scheduleLines.children[index];
      row.querySelector('[data-date]').value = date;
      row.querySelector('[data-amount]').value = amount;
    });
    $('#add-batch').disabled = rows.length >= maxBatches;
  }

  function showScheduleMode() {
    const custom = input.mode.value === 'custom';
    $('#preset-setup').hidden = custom;
    $('#schedule-editor').hidden = !custom;
  }

  function switchSchedule() {
    if (input.mode.value === 'custom' && !scheduleLines.children.length) {
      const settings = formValue();
      const hasBudget = parseBudget(settings.budget) !== null;
      renderSchedule(presetSchedule({ ...settings, start: input.start.value || today() })
        .map((row) => ({ ...row, amount: hasBudget ? row.amount : '' })));
    } else if (input.mode.value === 'preset' && activeRecord()?.trades.some(({ batchId }) => !/^batch-[1-3]$/.test(batchId))) {
      input.mode.value = 'custom';
      setText('#save-status', '自定义批次已有成交，保留这些批次后可继续调整。');
      return;
    }
    showScheduleMode();
    updateDraft();
  }

  function renderQuoteContext() {
    $('#quote-transfer').hidden = !quoteContext;
    if (quoteContext) setText('#quote-transfer', '采用 ' + quoteContext.name + ' 的报价（'
      + quoteDate.format(quoteContext.quotedAt) + '）。固定费用按每批一次计算。');
  }

  function renderCurrentPlan(settings = formValue()) {
    const budget = parseBudget(settings.budget);
    const { value, errors } = validate(settings);
    const preview = value ? estimate(value).stages : budget !== null && !settings.schedule ? presetSchedule(settings) : [];
    $('#quick-preview').hidden = !preview.length;
    const head = preview.slice(0, 3);
    const previewRows = head.map(({ amount }, index) => [batchName(index), amount]);
    if (preview.length > head.length) previewRows.push(['其余 ' + (preview.length - head.length) + ' 批',
      preview.slice(head.length).reduce((sum, { amount }) => sum + amount, 0)]);
    $('#quick-preview').innerHTML = previewRows.map(([label, amount]) => `<div><dt>${label}</dt><dd>${yuan(amount)}</dd></div>`).join('');
    if (settings.schedule) {
      const total = settings.schedule.reduce((sum, row) => sum + BigInt(parseYuan(row.amount) ?? 0), 0n);
      const delta = budget === null ? 0n : BigInt(budget) - total;
      setText('#schedule-status', '已分配 ¥' + integer.format(total) + (delta === 0n ? ''
        : (delta > 0n ? '，尚余 ¥' : '，超出 ¥') + integer.format(delta > 0n ? delta : -delta)));
    }
    $('#plan-result-content').hidden = !value;
    $('#plan-result-empty').hidden = Boolean(value);
    $('#plan-profile').hidden = !value;
    if (value) {
      renderPlan(value, activeRecord());
    } else {
      const empty = !String(settings.budget ?? '').trim() ? '输入预算后即可试算。' : Object.values(errors)[0];
      setText('#plan-result-empty', empty);
    }
    return value;
  }

  function renderPlan(settings, saved) {
    const plan = estimate(settings);
    const trades = saved?.trades ?? [];
    const savedBatches = new Set(saved ? estimate(saved).stages.map(({ id }) => id) : []);
    const progress = purchaseProgress(plan.budget, trades);
    const stageList = $('#plan-stages');
    const opened = new Set([...stageList.querySelectorAll('details[open]')].map((entry) => entry.dataset.tradeList));
    setText('#plan-total', yuan(plan.budget));
    setText('#plan-profile', plan.stages.length + ' 批');
    setText('#plan-description', settings.schedule ? '按自定义日期与金额分批。'
      : horizons[plan.horizon].title + '持有，' + risks[plan.risk].description);
    $('#estimate-summary').hidden = plan.grams === null && plan.fee === 0;
    setText('#plan-grams', plan.grams === null ? '—' : grams.format(plan.grams) + ' 克');
    setText('#plan-fees', preciseYuan(plan.fee));
    $('#plan-progress').hidden = !saved;
    const booked = new Set(trades.map(({ batchId }) => batchId));
    setText('#purchase-count', booked.size + '/' + plan.stages.length + ' 批 · ' + progress.count + ' 笔成交');
    setText('#purchase-spent', preciseYuan(progress.spent));
    setText('#purchase-grams', grams.format(progress.grams) + ' 克');
    setText('#purchase-balance-label', progress.remaining < 0 ? '超出预算' : '剩余预算');
    setText('#purchase-balance', preciseYuan(Math.abs(progress.remaining)));
    setText('#purchase-average', progress.average === null ? '—' : preciseYuan(progress.average) + '/克');
    $('#allocation-bar').innerHTML = plan.stages.map(({ weight }) => `<i style="width:${weight}%"></i>`).join('');
    stageList.innerHTML = plan.stages.map(({ id, weight, amount, date, grams: mass }, index) => {
      const entries = trades.filter(({ batchId }) => batchId === id).reverse().sort((a, b) => b.date.localeCompare(a.date));
      const byBatch = purchaseProgress(amount, entries);
      return `<li>
        <div class="stage-label"><strong>${batchName(index)}</strong><span>${date}</span></div>
        <div class="stage-amount numeric"><strong>${yuan(amount)}</strong><span>${ratios.format(weight)}%${mass === null ? '' : ' · ' + grams.format(mass) + ' 克'}</span></div>
        ${savedBatches.has(id) ? `<div class="stage-purchase">
          <span>${entries.length ? grams.format(byBatch.grams) + ' 克 · ' + preciseYuan(byBatch.spent) : '未记录成交'}</span>
          <button type="button" class="outline-button" data-purchase="${id}" aria-label="${batchName(index)}记一笔">记一笔</button>
        </div>
        ${entries.length ? `<details class="batch-trades" data-trade-list="${id}" ${opened.has(id) ? 'open' : ''}>
          <summary>查看 ${entries.length} 笔成交</summary>
          <ul>${entries.map((trade) => `<li class="trade-line"><span><time datetime="${trade.date}">${trade.date}</time>
            <small data-trade-note="${trade.id}"></small></span><span><strong>${preciseYuan(trade.paid)}</strong>
            <small>${grams.format(trade.grams)} 克</small></span>
            <button type="button" class="text-button" data-purchase="${id}" data-trade="${trade.id}">编辑</button></li>`).join('')}</ul>
        </details>` : ''}` : saved ? '<p class="stage-purchase">保存批次后即可记录成交。</p>' : ''}
      </li>`;
    }).join('');
    for (const trade of trades) {
      const note = stageList.querySelector(`[data-trade-note="${trade.id}"]`);
      if (note) note.textContent = trade.note;
    }
    scheduleLines.querySelectorAll('[data-remove-batch]').forEach((button) => {
      button.disabled = scheduleLines.children.length === 1 || booked.has(button.closest('[data-batch]').dataset.batch);
    });
  }

  function clearErrors() {
    form.querySelectorAll('[aria-invalid]').forEach((field) => field.removeAttribute('aria-invalid'));
    $('#plan-error').hidden = true;
  }

  function checkedForm() {
    clearErrors();
    const { value, errors } = validate(formValue());
    if (value) return value;
    const [field, message] = Object.entries(errors)[0];
    const target = input.namedItem(field);
    if (target instanceof HTMLElement) {
      const details = target.closest('details');
      if (details) details.open = true;
      target.setAttribute('aria-invalid', 'true');
      target.focus();
    }
    if (field === 'schedule') scheduleLines.querySelector('[data-amount]')?.focus();
    setText('#plan-error', message);
    $('#plan-error').hidden = false;
    return null;
  }

  function updateDraft() {
    clearErrors();
    hasDraft = formFingerprint() !== cleanSettings;
    const value = renderCurrentPlan();
    setText('#save-status', !hasDraft ? '' : value ? '试算已更新。保存后可记录实际买入。' : '补齐有效设置后即可保存。');
  }

  function action(text, style, handler) {
    const button = document.createElement('button');
    button.textContent = text;
    button.type = 'button';
    button.className = style;
    button.addEventListener('click', handler);
    return button;
  }

  function renderLibrary() {
    $('#library-empty').hidden = Boolean(records.length);
    $('#backup-plans').disabled = !records.length;
    const list = $('#saved-plans');
    const ordered = records.slice().sort((a, b) => b.updatedAt - a.updatedAt);
    const current = activeRecord();
    $('#plan-overview').hidden = !records.length;
    $('#jump-to-progress').hidden = !current;
    setText('#plan-overview-name', current?.name ?? '新计划');
    const recent = current?.trades.slice().reverse().sort((a, b) => b.date.localeCompare(a.date))[0];
    setText('#plan-overview-summary', current ? '预算 ' + yuan(current.budget) + (recent
      ? '，最近买入 ' + recent.date + ' · ' + preciseYuan(recent.paid) : '，等待登记成交') : '已有 ' + records.length + ' 份计划');
    list.replaceChildren(...ordered.map((record) => {
      const row = document.createElement('li');
      const description = document.createElement('div');
      const title = document.createElement('strong');
      const detail = document.createElement('span');
      title.textContent = record.name;
      detail.textContent = yuan(record.budget) + ' · ' + (record.schedule?.length ?? 3) + ' 批 · ' + record.trades.length + ' 笔成交';
      description.append(title, detail);
      const controls = document.createElement('div');
      controls.className = 'library-actions';
      controls.append(action(record.id === activeId ? '正在编辑' : '编辑', 'outline-button', () => {
        if (!canLeaveDraft()) return;
        fill(record);
        input.budget.focus();
      }), action('日历', 'outline-button', () => exportCalendar(record, record.id)), action('删除', 'text-button remove-plan', () => {
        if (!window.confirm('删除计划「' + record.name + '」？')) return;
        const saved = saveRecords(currentRecords().filter((item) => item.id !== record.id));
        if (activeId === record.id) {
          fill(defaults());
        }
        setText('#library-status', saved ? '计划已删除。' : '已从当前页面移除，浏览器未保存此变更。');
      }));
      row.append(description, controls);
      return row;
    }));
  }

  function canLeaveDraft() {
    return !hasDraft || window.confirm('当前修改尚未保存。放弃修改？');
  }

  function jumpTo(target, heading) {
    $(heading).focus({ preventScroll: true });
    $(target).scrollIntoView({ block: 'start' });
  }

  function download(name, content, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportCalendar(settings, id) {
    download('Aurelia-黄金复盘.ics', planCalendar(settings, id), 'text/calendar;charset=utf-8');
  }

  function purchaseError(message, field) {
    const target = $('#purchase-error');
    target.textContent = message;
    target.hidden = !message;
    for (const input of purchaseForm.querySelectorAll('input')) {
      input.toggleAttribute('aria-invalid', input.name === field);
    }
    if (field) purchaseFields.namedItem(field).focus();
  }

  function openPurchase(batchId, tradeId) {
    const record = currentRecords().find((item) => item.id === activeId);
    if (!record) {
      setText('#purchase-status', '找不到这份已保存的计划。请先重新保存。');
      return;
    }
    const batch = estimate(record).stages.findIndex((stage) => stage.id === batchId);
    const entry = record.trades.find((trade) => trade.id === tradeId && trade.batchId === batchId);
    if (batch < 0 || (tradeId && !entry)) {
      setText('#purchase-status', '这项记录已更新，请重新打开计划。');
      return;
    }
    if (!entry && record.trades.length >= maxTrades) {
      setText('#purchase-status', '此计划已记录 ' + maxTrades + ' 笔。可导出后另建计划。');
      return;
    }
    editingPurchase = { id: record.id, batchId, tradeId, original: JSON.stringify(entry) };
    purchaseFields.date.value = entry?.date ?? today();
    purchaseFields.date.max = today();
    purchaseFields.paid.value = entry?.paid ?? '';
    purchaseFields.grams.value = entry?.grams ?? '';
    purchaseFields.note.value = entry?.note ?? '';
    setText('#purchase-title', entry ? '编辑买入记录' : '记录实际买入');
    setText('#purchase-context', record.name + ' · ' + batchName(batch));
    $('#purchase-remove').hidden = !entry;
    purchaseError('');
    dialog.showModal();
    $('#purchase-title').focus();
  }

  function savePurchase(purchase) {
    const { id, batchId, tradeId, original } = editingPurchase;
    const existing = currentRecords();
    const record = existing.find((item) => item.id === id);
    if (!record || !estimate(record).stages.some((stage) => stage.id === batchId)
      || (tradeId && JSON.stringify(record.trades.find((trade) => trade.id === tradeId)) !== original)) {
      purchaseError('此记录已在另一标签页更新。请关闭后重新打开。');
      return;
    }
    const trades = record.trades.filter((trade) => trade.id !== tradeId);
    if (purchase) {
      if (trades.length >= maxTrades) {
        purchaseError('本计划已达到成交记录上限。');
        return;
      }
      trades.push({ ...purchase, id: tradeId ?? makeId(), batchId });
    }
    const next = normalizeRecord({ ...record, trades, updatedAt: Date.now() });
    const saved = saveRecords(existing.map((item) => item.id === id ? next : item));
    renderCurrentPlan();
    const details = $(`[data-trade-list="${batchId}"]`);
    if (details && purchase) details.open = true;
    setText('#purchase-status', saved ? (purchase ? '已保存买入记录。' : '已删除买入记录。')
      : '当前页面已保留变更，请下载备份。');
    dialog.close();
  }

  function applyQuote(pricing, quote) {
    if (activeId) {
      if (!canLeaveDraft()) return;
      fill(defaults());
    }
    input.price.value = pricing.price;
    input.fee.value = pricing.fee || '';
    input.fixedFee.value = pricing.fixedFee || '';
    $('#plan-estimate-fields').open = true;
    quoteContext = quote;
    renderQuoteContext();
    updateDraft();
    location.hash = '#/plan';
  }

  renderChoices('#horizon-choices', 'horizon', horizons);
  renderChoices('#risk-choices', 'risk', risks);
  records = restore();
  fill(records.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? defaults());
  setText('#library-status', notice);
  form.addEventListener('input', (event) => {
    if (event.target.name === 'mode') {
      switchSchedule();
      return;
    }
    if (['price', 'fee', 'fixedFee'].includes(event.target.name)) {
      quoteContext = null;
      renderQuoteContext();
    }
    updateDraft();
  });
  $('#new-plan').addEventListener('click', () => {
    if (!canLeaveDraft()) return;
    fill(defaults());
    input.budget.focus();
  });
  $('#jump-to-progress').addEventListener('click', () => jumpTo('#plan-result', '#result-title'));
  $('#jump-to-library').addEventListener('click', () => jumpTo('.library-card', '#library-title'));
  $('#add-batch').addEventListener('click', () => {
    const rows = readSchedule();
    if (rows.length >= maxBatches) return;
    rows.push({ id: makeId(), date: rows.at(-1)?.date || today(), amount: '' });
    renderSchedule(rows);
    updateDraft();
    scheduleLines.lastElementChild.querySelector('[data-date]').focus();
  });
  $('#split-evenly').addEventListener('click', () => {
    const budget = parseBudget(input.budget.value);
    const rows = readSchedule();
    if (!budget || !rows.length) {
      setText('#save-status', '输入总预算后即可均分。');
      input.budget.focus();
      return;
    }
    const equal = Math.floor(budget / rows.length);
    const remainder = budget % rows.length;
    rows.forEach((row, index) => { row.amount = equal + Number(index < remainder); });
    renderSchedule(rows);
    updateDraft();
  });
  scheduleLines.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-batch]');
    if (!remove || remove.disabled) return;
    const id = remove.closest('[data-batch]').dataset.batch;
    renderSchedule(readSchedule().filter((row) => row.id !== id));
    updateDraft();
    $('#add-batch').focus();
  });

  document.querySelectorAll('[data-budget]').forEach((button) => {
    button.addEventListener('click', () => {
      input.budget.value = integer.format(Number(button.dataset.budget));
      updateDraft();
    });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const settings = checkedForm();
    if (!settings) return;
    const existing = currentRecords();
    const prior = existing.find((record) => record.id === activeId);
    const id = prior?.id ?? (activeId ? makeId() : draftId);
    if (prior?.trades.some((trade) => !(settings.schedule ?? presetSchedule(settings)).some((row) => row.id === trade.batchId))) {
      setText('#save-status', '被移除的批次已有成交。请保留批次，或先处理相关记录。');
      return;
    }
    const schedule = settings.schedule?.slice().sort((a, b) => a.date.localeCompare(b.date));
    const record = normalizeRecord({ ...settings, schedule, id, updatedAt: Date.now(), trades: prior?.trades });
    const saved = saveRecords([record, ...existing.filter((item) => item.id !== id)]);
    fill(record);
    setText('#save-status', saved ? '计划已保存。' : '当前页面已保留计划。请下载备份以便恢复。');
    if (window.matchMedia('(max-width: 820px)').matches) {
      setText('#purchase-status', $('#save-status').textContent);
      jumpTo('#plan-result', '#result-title');
    }
  });

  $('#download-plan').addEventListener('click', () => {
    const settings = checkedForm();
    if (!settings) return;
    const saved = currentRecords().find((record) => record.id === activeId);
    download('Aurelia-分批计划.csv', planCsv({ ...settings, trades: saved?.trades }, estimate(settings)), 'text/csv;charset=utf-8');
  });
  $('#download-calendar').addEventListener('click', () => {
    const settings = checkedForm();
    if (settings) exportCalendar(settings, draftId);
  });
  $('#backup-plans').addEventListener('click', () => download('Aurelia-计划备份-' + today() + '.json',
    encodeBackup(currentRecords()), 'application/json;charset=utf-8'));
  $('#import-plans').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      if (file.size > 16 * 1024 * 1024) throw Error('Backup is too large');
      const incoming = decodeBackup(await file.text());
      const existing = currentRecords();
      const combined = mergeRecords(existing, incoming, makeId);
      const count = combined.length - existing.length;
      if (!count) {
        setText('#library-status', '没有需要新增的计划。');
      } else {
        const saved = saveRecords(combined);
        setText('#library-status', '已导入 ' + count + ' 份计划。' + (saved ? '' : '请下载备份以便恢复。'));
      }
    } catch {
      setText('#library-status', '无法读取此备份，请选择 Aurelia 导出的 JSON 文件。');
    } finally {
      fileInput.value = '';
    }
  });

  window.addEventListener('storage', (event) => {
    if (event.key !== storageKey || usingMemory) return;
    try {
      records = readRecords() ?? [];
      renderLibrary();
      renderCurrentPlan();
    } catch { /* Retain the working library. */ }
  });

  $('#use-reference').addEventListener('click', () => {
    if (!reference) return;
    input.price.value = reference.cny.toFixed(2);
    quoteContext = null;
    renderQuoteContext();
    updateDraft();
  });

  $('#plan-stages').addEventListener('click', (event) => {
    const button = event.target.closest('[data-purchase]');
    if (button) openPurchase(button.dataset.purchase, button.dataset.trade);
  });

  purchaseForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!editingPurchase) return;
    const { value, errors } = validatePurchase(Object.fromEntries(new FormData(purchaseForm)));
    if (!value) {
      const [field, message] = Object.entries(errors)[0];
      purchaseError(message, field);
    } else if (value.date > today()) {
      purchaseError('买入日期须为今天或之前。', 'date');
    } else {
      savePurchase(value);
    }
  });
  $('#purchase-cancel').addEventListener('click', () => dialog.close());
  $('#purchase-remove').addEventListener('click', () => {
    if (editingPurchase?.tradeId && window.confirm('删除这笔成交？')) savePurchase(null);
  });
  dialog.addEventListener('close', () => {
    if (editingPurchase?.id === activeId) {
      const { batchId, tradeId } = editingPurchase;
      const target = tradeId ? $(`[data-purchase="${batchId}"][data-trade="${tradeId}"]`) : null;
      (target ?? $(`[data-purchase="${batchId}"]`))?.focus({ preventScroll: true });
    }
    editingPurchase = undefined;
  });
  mountAureliaComparison({ applyQuote, download, makeId, jumpTo });

  return {
    setReference(value) {
      reference = value;
      $('#use-reference').disabled = !value;
      setText('#use-reference', value ? '填入市场参考价 ' + preciseYuan(value.cny) + '/克' : '等待市场参考价');
    },
  };
}
