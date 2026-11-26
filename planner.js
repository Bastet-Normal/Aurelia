'use strict';

function mountAureliaPlanner() {
  const { risks, horizons, restorePlan, defaultPlan, parseBudget, buildPlan } = aureliaModel;
  const { storageKey, previousStorageKey, today, validate, estimate, validatePurchase, purchaseProgress, normalizeRecord,
    encodeBackup, decodeBackup, mergeRecords, planCsv, planCalendar, priceComparison } = aureliaPlans;
  const $ = (selector) => document.querySelector(selector);
  const integer = new Intl.NumberFormat('en-US');
  const costs = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const grams = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
  const yuan = (value) => '¥' + integer.format(value);
  const preciseYuan = (value) => (value < 0 ? '−' : '') + '¥' + costs.format(Math.abs(value));
  const setText = (selector, value) => { if ($(selector).textContent !== value) $(selector).textContent = value; };

  const form = $('#plan-form');
  const input = form.elements;
  const fileInput = $('#plan-import-file');
  const dialog = $('#purchase-dialog');
  const purchaseForm = $('#purchase-form');
  const purchaseFields = purchaseForm.elements;
  const batchNames = ['首批', '第二批', '第三批'];
  const previewIds = ['#preview-first', '#preview-second', '#preview-third'];
  let activeId;
  let draftId;
  let reference;
  let records = [];
  let usingMemory = false;
  let hasDraft = false;
  let cleanSettings;
  let notice = '';
  let editingPurchase;

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
      const previous = window.localStorage.getItem(previousStorageKey);
      if (previous !== null) {
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
    return Object.fromEntries(new FormData(form));
  }

  function formFingerprint() {
    return JSON.stringify(formValue());
  }

  function fill(record) {
    activeId = record.id;
    draftId = record.id ?? makeId();
    input.name.value = record.name;
    input.start.value = record.start;
    input.budget.value = record.budget === '' ? '' : integer.format(record.budget);
    input.horizon.value = record.horizon;
    input.risk.value = record.risk;
    input.price.value = record.price ?? '';
    input.fee.value = record.fee || '';
    input.fixedFee.value = record.fixedFee || '';
    $('#plan-estimate-fields').open = Boolean(record.price || record.fee || record.fixedFee);
    $('#quote-transfer').hidden = true;
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

  function renderCurrentPlan(settings = formValue()) {
    const budget = parseBudget(settings.budget);
    $('#quick-preview').hidden = budget === null;
    if (budget !== null) {
      buildPlan(settings).stages.forEach(({ amount }, index) => setText(previewIds[index], yuan(amount)));
    }
    const { value, errors } = validate(settings);
    $('#plan-result-content').hidden = !value;
    $('#plan-result-empty').hidden = Boolean(value);
    $('#plan-profile').hidden = !value;
    if (value) {
      renderPlan(value, activeRecord());
    } else {
      const empty = !String(settings.budget ?? '').trim() ? '输入预算后即可查看三批安排。' : Object.values(errors)[0];
      setText('#plan-result-empty', empty);
    }
    return value;
  }

  function renderPlan(settings, saved) {
    const plan = estimate(settings);
    const progress = purchaseProgress(plan.budget, saved?.purchases);
    setText('#plan-total', yuan(plan.budget));
    setText('#plan-profile', risks[plan.risk].title);
    setText('#plan-description', horizons[plan.horizon].title + '持有 · ' + plan.description);
    $('#estimate-summary').hidden = plan.grams === null && plan.fee === 0;
    setText('#plan-grams', plan.grams === null ? '—' : grams.format(plan.grams) + ' 克');
    setText('#plan-fees', preciseYuan(plan.fee));
    $('#plan-progress').hidden = !saved;
    setText('#purchase-count', '已记录 ' + progress.count + ' / 3 批');
    setText('#purchase-spent', preciseYuan(progress.spent));
    setText('#purchase-grams', grams.format(progress.grams) + ' 克');
    setText('#purchase-balance-label', progress.remaining < 0 ? '超出预算' : '剩余预算');
    setText('#purchase-balance', preciseYuan(Math.abs(progress.remaining)));
    setText('#purchase-average', progress.average === null ? '—' : preciseYuan(progress.average) + '/克');
    $('#allocation-bar').innerHTML = plan.stages.map(({ weight }) => `<i style="width:${weight}%"></i>`).join('');
    $('#plan-stages').innerHTML = plan.stages.map(({ weight, amount, date, grams: mass }, index) => {
      const purchase = saved?.purchases?.[index];
      return `<li>
        <div class="stage-label"><strong>${batchNames[index]}</strong><span>${date} · ${index ? '复盘' : '计划起点'}</span></div>
        <div class="stage-amount numeric"><strong>${yuan(amount)}</strong><span>${weight}%${mass === null ? '' : ' · ' + grams.format(mass) + ' 克'}</span></div>
        ${saved ? `<div class="stage-purchase">
          <span>${purchase ? purchase.date + ' · ' + grams.format(purchase.grams) + ' 克 · ' + preciseYuan(purchase.paid) : '待记录'}</span>
          <button type="button" class="outline-button" data-purchase="${index}" aria-label="${batchNames[index]} · ${purchase ? '编辑买入记录' : '记录买入'}">${purchase ? '编辑记录' : '记录买入'}</button>
        </div>` : ''}
      </li>`;
    }).join('');
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
    setText('#plan-overview-summary', current ? '已记录 ' + purchaseProgress(current.budget, current.purchases).count + ' / 3 批'
      : '已有 ' + records.length + ' 份计划');
    list.replaceChildren(...ordered.map((record) => {
      const row = document.createElement('li');
      const description = document.createElement('div');
      const title = document.createElement('strong');
      const detail = document.createElement('span');
      title.textContent = record.name;
      const progress = purchaseProgress(record.budget, record.purchases);
      detail.textContent = yuan(record.budget) + ' · ' + record.start + ' · 已记录 ' + progress.count + ' / 3 批';
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

  function openPurchase(index) {
    const record = currentRecords().find((item) => item.id === activeId);
    if (!record) {
      setText('#purchase-status', '找不到这份已保存的计划。请先重新保存。');
      return;
    }
    const entry = record.purchases[index];
    editingPurchase = { id: record.id, index, original: JSON.stringify(entry) };
    purchaseFields.date.value = entry?.date ?? today();
    purchaseFields.date.max = today();
    purchaseFields.paid.value = entry?.paid ?? '';
    purchaseFields.grams.value = entry?.grams ?? '';
    setText('#purchase-title', entry ? '编辑买入记录' : '记录实际买入');
    setText('#purchase-context', record.name + ' · ' + batchNames[index] + '。每批保留一笔记录，可填写该批汇总。');
    $('#purchase-remove').hidden = !entry;
    purchaseError('');
    dialog.showModal();
    $('#purchase-title').focus();
  }

  function savePurchase(purchase) {
    const { id, index, original } = editingPurchase;
    const existing = currentRecords();
    const record = existing.find((item) => item.id === id);
    if (!record || JSON.stringify(record.purchases[index]) !== original) {
      purchaseError('此记录已在另一标签页更新。请关闭后重新打开。');
      return;
    }
    const purchases = record.purchases.slice();
    purchases[index] = purchase;
    const next = normalizeRecord({ ...record, purchases, updatedAt: Date.now() });
    const saved = saveRecords(existing.map((item) => item.id === id ? next : item));
    renderCurrentPlan();
    setText('#purchase-status', saved ? (purchase ? '已保存买入记录。' : '已删除买入记录。')
      : '当前页面已保留变更，请下载备份。');
    dialog.close();
  }

  function applyQuote(pricing, side) {
    if (activeId) {
      if (!canLeaveDraft()) return;
      fill(defaults());
    }
    input.price.value = pricing.price;
    input.fee.value = pricing.fee || '';
    input.fixedFee.value = pricing.fixedFee || '';
    $('#plan-estimate-fields').open = true;
    const note = '已带入渠道 ' + side + ' 的买入单价和费用。'
      + (pricing.fixedFee ? '固定费按每批一次计入，可在估算设置里修改。' : '输入预算即可估算克数。');
    setText('#quote-transfer', note);
    $('#quote-transfer').hidden = false;
    updateDraft();
    location.hash = '#/plan';
  }

  function mountComparison() {
    const comparison = $('#comparison-form');
    const fields = [
      ['buy', '买入单价（¥/克）', '例如 780'],
      ['sell', '回购单价（¥/克，选填）', '例如 760'],
      ['fixed', '整笔工费或固定费（¥）', '0'],
      ['buyRate', '额外买入费率（%）', '0'],
      ['sellRate', '额外回购费率（%）', '0'],
    ];
    const sides = ['A', 'B'];
    comparison.innerHTML = sides.map((side) => {
      const field = ([name, label, placeholder]) =>
        `<label class="form-field"><span>${label}</span><input name="${side}-${name}" inputmode="decimal" placeholder="${placeholder}" aria-describedby="compare-${side}-status"></label>`;
      return `<fieldset class="offer">
        <legend>渠道 ${side}</legend>
        <div class="form-fields">${fields.slice(0, 2).map(field).join('')}</div>
        <details class="method-note offer-fees"><summary>填写额外费用</summary>
          <div class="form-fields">${fields.slice(2).map(field).join('')}</div>
        </details>
        <p class="field-hint" id="compare-${side}-status"></p>
        <dl class="offer-results" id="compare-${side}-results" hidden></dl>
        <div class="offer-actions" id="compare-${side}-actions" hidden>
          <button type="button" class="outline-button" id="use-quote-${side}" aria-label="用渠道 ${side} 报价试算计划">用此报价做计划</button>
        </div>
      </fieldset>`;
    }).join('');

    const pricingBySide = new Map();
    for (const side of sides) {
      $('#use-quote-' + side).addEventListener('click', () => {
        const pricing = pricingBySide.get(side);
        if (pricing) applyQuote(pricing, side);
      });
    }

    function renderComparison() {
      const data = new FormData(comparison);
      const amountField = $('#compare-grams');
      const results = sides.map((side) => {
        const offer = Object.fromEntries(fields.map(([name]) => [name, data.get(side + '-' + name)]));
        const { errors, pricing, result } = priceComparison(data.get('grams'), offer);
        pricingBySide.set(side, pricing);
        amountField.toggleAttribute('aria-invalid', Boolean(errors.grams));
        for (const [name] of fields) {
          comparison.elements.namedItem(side + '-' + name).toggleAttribute('aria-invalid', Boolean(errors[name]));
        }
        const issue = fields.map(([name]) => errors[name]).find(Boolean);
        setText('#compare-' + side + '-status', issue || '');
        const output = $('#compare-' + side + '-results');
        output.hidden = !result;
        $('#compare-' + side + '-actions').hidden = !result;
        if (!result) return { result, error: errors.grams };
        const amounts = [['买入总价', result.total], ['含费克价', result.unit], ['回购保本价 / 克', result.breakEven]];
        if (result.netSale !== null) amounts.push(['回购净额', result.netSale], ['按此报价盈亏', result.difference]);
        output.innerHTML = amounts.map(([label, value]) => `<div><dt>${label}</dt><dd>${preciseYuan(value)}</dd></div>`).join('');
        return { result };
      });
      const [first, second] = results;
      let summary = first.error || '填入一个渠道即可试算，填入两个渠道即可比较。';
      if (first.result && second.result) {
        const delta = first.result.total - second.result.total;
        summary = costs.format(Math.abs(delta)) === '0.00' ? '两渠道的买入总价相差不足 ¥0.01。'
          : '同等克重下，渠道 ' + (delta < 0 ? 'A' : 'B') + ' 的买入总价低 ' + preciseYuan(Math.abs(delta)) + '。';
      }
      setText('#comparison-summary', summary);
    }
    $('#compare-grams').setAttribute('aria-describedby', 'comparison-summary');
    comparison.addEventListener('submit', (event) => event.preventDefault());
    comparison.addEventListener('input', renderComparison);
    $('#compare-grams').addEventListener('input', renderComparison);
    renderComparison();
  }

  renderChoices('#horizon-choices', 'horizon', horizons);
  renderChoices('#risk-choices', 'risk', risks);
  records = restore();
  fill(records.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? defaults());
  setText('#library-status', notice);
  form.addEventListener('input', (event) => {
    if (['price', 'fee', 'fixedFee'].includes(event.target.name)) $('#quote-transfer').hidden = true;
    updateDraft();
  });
  $('#new-plan').addEventListener('click', () => {
    if (!canLeaveDraft()) return;
    fill(defaults());
    input.budget.focus();
  });
  $('#jump-to-progress').addEventListener('click', () => jumpTo('#plan-result', '#result-title'));
  $('#jump-to-library').addEventListener('click', () => jumpTo('.library-card', '#library-title'));

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
    const record = normalizeRecord({ ...settings, id, updatedAt: Date.now(), purchases: prior?.purchases });
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
    download('Aurelia-分批计划.csv', planCsv({ ...settings, purchases: saved?.purchases }, estimate(settings)), 'text/csv;charset=utf-8');
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
      if (file.size > 2 * 1024 * 1024) throw Error('Backup is too large');
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
    $('#quote-transfer').hidden = true;
    updateDraft();
  });

  $('#plan-stages').addEventListener('click', (event) => {
    const button = event.target.closest('[data-purchase]');
    if (button) openPurchase(Number(button.dataset.purchase));
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
    if (editingPurchase && window.confirm('删除这批买入记录？')) savePurchase(null);
  });
  dialog.addEventListener('close', () => {
    if (editingPurchase?.id === activeId) {
      $(`[data-purchase="${editingPurchase.index}"]`)?.focus({ preventScroll: true });
    }
    editingPurchase = undefined;
  });
  mountComparison();

  return {
    setReference(value) {
      reference = value;
      $('#use-reference').disabled = !value;
      setText('#use-reference', value ? '填入市场参考价 ' + preciseYuan(value.cny) + '/克' : '等待市场参考价');
    },
  };
}
