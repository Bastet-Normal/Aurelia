'use strict';

function mountAureliaPlanner() {
  const { risks, horizons, restorePlan, defaultPlan } = aureliaModel;
  const { storageKey, today, validate, estimate, normalizeRecord, encodeBackup, decodeBackup, mergeRecords, planCsv, planCalendar, priceComparison } = aureliaPlans;
  const $ = (selector) => document.querySelector(selector);
  const integer = new Intl.NumberFormat('en-US');
  const costs = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const grams = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
  const yuan = (value) => '¥' + integer.format(value);
  const preciseYuan = (value) => (value < 0 ? '−' : '') + '¥' + costs.format(Math.abs(value));
  const setText = (selector, value) => { if ($(selector).textContent !== value) $(selector).textContent = value; };

  const form = $('#plan-form');
  const input = form.elements;
  const fileInput = $('#plan-import-file');
  let activeId;
  let draftId;
  let reference;
  let records = [];
  let usingMemory = false;
  let hasDraft = false;
  let cleanSettings;
  let notice = '';

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
    return { ...defaultPlan, name: '黄金分批计划', start: today(), price: null, fee: 0 };
  }

  function restore() {
    try {
      const existing = readRecords();
      if (existing) return existing;
      const newest = window.localStorage.getItem('aurelia-plan-v1');
      const old = newest ? JSON.parse(newest) : {
        budget: window.localStorage.getItem('aurelia-budget'),
        risk: window.localStorage.getItem('aurelia-risk'),
      };
      if (old?.budget || old?.risk) {
        const migrated = { ...defaults(), ...restorePlan(old), name: '旧版计划', id: makeId(), updatedAt: Date.now() };
        saveRecords([migrated]);
        return [migrated];
      }
    } catch {
      notice = '无法读取原有计划。可从备份恢复，当前内容可先保留在这一页。';
    }
    return [];
  }

  function renderChoices(target, name, options) {
    $(target).innerHTML = Object.entries(options).map(([key, { title, weights, description }]) => `
      <label class="choice">
        <input type="radio" name="${name}" value="${key}" required>
        <span><strong>${title}</strong>${weights ? `<small>${weights.map((weight) => weight + '%').join(' / ')}</small>` : ''}${description ? `<em>${description}</em>` : ''}</span>
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
    input.budget.value = integer.format(record.budget);
    input.horizon.value = record.horizon;
    input.risk.value = record.risk;
    input.price.value = record.price ?? '';
    input.fee.value = record.fee || '';
    cleanSettings = formFingerprint();
    hasDraft = false;
    clearErrors();
    setText('#save-status', '');
    renderPlan(record);
    renderLibrary();
  }

  function renderPlan(settings) {
    const plan = estimate(settings);
    setText('#plan-total', yuan(plan.budget));
    setText('#plan-profile', risks[plan.risk].title);
    setText('#plan-description', horizons[plan.horizon].title + '持有 · ' + plan.description);
    $('#estimate-summary').hidden = plan.grams === null && plan.fee === 0;
    setText('#plan-grams', plan.grams === null ? '—' : grams.format(plan.grams) + ' 克');
    setText('#plan-fees', preciseYuan(plan.fee));
    $('#allocation-bar').innerHTML = plan.stages.map(({ weight }) => `<i style="width:${weight}%"></i>`).join('');
    const labels = ['首批预算', '第二批预算', '第三批预算'];
    $('#plan-stages').innerHTML = plan.stages.map(({ weight, amount, date, grams: mass }, index) => `
      <li>
        <div class="stage-label"><strong>${labels[index]}</strong><span>${date} · ${index ? '复盘' : '计划起点'}</span></div>
        <div class="stage-amount numeric"><strong>${yuan(amount)}</strong><span>${weight}%${mass === null ? '' : ' · ' + grams.format(mass) + ' 克'}</span></div>
      </li>`).join('');
    return plan;
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
    const { value } = validate(formValue());
    if (value) renderPlan(value);
    setText('#save-status', !hasDraft ? '' : value ? '预览已更新，保存后加入计划列表。' : '修正输入后会更新预览。');
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
    list.replaceChildren(...ordered.map((record) => {
      const row = document.createElement('li');
      const description = document.createElement('div');
      const title = document.createElement('strong');
      const detail = document.createElement('span');
      title.textContent = record.name;
      detail.textContent = yuan(record.budget) + ' · ' + record.start + ' · ' + risks[record.risk].title;
      description.append(title, detail);
      const controls = document.createElement('div');
      controls.className = 'library-actions';
      controls.append(action(record.id === activeId ? '正在编辑' : '编辑', 'outline-button', () => {
        if (!canLeaveDraft()) return;
        fill(record);
        input.name.focus();
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

  function mountComparison() {
    const comparison = $('#comparison-form');
    const fields = [
      ['buy', '买入单价（¥/克）', '例如 780'],
      ['sell', '回购单价（¥/克，选填）', '例如 760'],
      ['fixed', '额外工费或固定费（¥）', '0'],
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
      </fieldset>`;
    }).join('');

    function renderComparison() {
      const data = new FormData(comparison);
      const amountField = $('#compare-grams');
      const results = sides.map((side) => {
        const offer = Object.fromEntries(fields.map(([name]) => [name, data.get(side + '-' + name)]));
        const { errors, result } = priceComparison(data.get('grams'), offer);
        amountField.toggleAttribute('aria-invalid', Boolean(errors.grams));
        for (const [name] of fields) {
          comparison.elements.namedItem(side + '-' + name).toggleAttribute('aria-invalid', Boolean(errors[name]));
        }
        const issue = fields.map(([name]) => errors[name]).find(Boolean);
        setText('#compare-' + side + '-status', issue || (result || errors.grams ? '' : '填写买入单价即可比较。'));
        const output = $('#compare-' + side + '-results');
        output.hidden = !result;
        if (!result) return { result, error: errors.grams };
        const amounts = [['买入总价', result.total], ['含费克价', result.unit], ['回购保本价 / 克', result.breakEven]];
        if (result.netSale !== null) amounts.push(['回购净额', result.netSale], ['按此报价盈亏', result.difference]);
        output.innerHTML = amounts.map(([label, value]) => `<div><dt>${label}</dt><dd>${preciseYuan(value)}</dd></div>`).join('');
        return { result };
      });
      const [first, second] = results;
      let summary = first.error || '分别输入两个渠道的买入单价，比较同等克重的含费总价。';
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
  form.addEventListener('input', updateDraft);
  $('#new-plan').addEventListener('click', () => {
    if (!canLeaveDraft()) return;
    fill(defaults());
    input.name.select();
  });

  document.querySelectorAll('[data-budget]').forEach((button) => {
    button.addEventListener('click', () => {
      input.budget.value = integer.format(Number(button.dataset.budget));
      updateDraft();
      input.budget.focus();
    });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const settings = checkedForm();
    if (!settings) return;
    const existing = currentRecords();
    const id = existing.some((record) => record.id === activeId) ? activeId : activeId ? makeId() : draftId;
    const record = normalizeRecord({ ...settings, id, updatedAt: Date.now() });
    const saved = saveRecords([record, ...existing.filter((item) => item.id !== id)]);
    fill(record);
    setText('#save-status', saved ? '计划已保存。' : '当前页面已保留计划。请下载备份以便恢复。');
    if (window.matchMedia('(max-width: 820px)').matches) {
      $('#result-title').focus({ preventScroll: true });
      $('#plan-result').scrollIntoView({ block: 'start' });
    }
  });

  $('#download-plan').addEventListener('click', () => {
    const settings = checkedForm();
    if (settings) download('Aurelia-分批计划.csv', planCsv(settings, estimate(settings)), 'text/csv;charset=utf-8');
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
    } catch { /* Retain the working library. */ }
  });

  $('#use-reference').addEventListener('click', () => {
    if (!reference) return;
    input.price.value = reference.cny.toFixed(2);
    updateDraft();
  });
  mountComparison();

  return {
    setReference(value) {
      reference = value;
      $('#use-reference').disabled = !value;
      setText('#use-reference', value ? '填入 ' + value.date + ' 参考价 ' + preciseYuan(value.cny) + '/克' : '等待可用的市场参考价');
    },
  };
}
