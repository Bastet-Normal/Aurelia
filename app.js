const todayLabel = document.querySelector('#today-label');
if (todayLabel) {
  const now = new Date();
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now).toUpperCase();
  const date = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }).format(now).toUpperCase();
  todayLabel.textContent = `${weekday}, ${date}`;
}

const toast = (message) => {
  const existing = document.querySelector('.toast');
  existing?.remove();
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  document.body.appendChild(node);
  window.setTimeout(() => node.remove(), 2200);
};

const savedBudget = window.localStorage.getItem('aurelia-budget');
const savedRisk = window.localStorage.getItem('aurelia-risk');
if (savedBudget && document.querySelector('#budget')) document.querySelector('#budget').value = savedBudget;
if (savedRisk && document.querySelector('#risk')) document.querySelector('#risk').value = savedRisk;

document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((nav) => nav.classList.remove('active'));
    item.classList.add('active');
    document.getElementById(item.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast(`${item.textContent.trim()} · 已定位`);
  });
});
document.querySelectorAll('.range-select').forEach((button) => {
  button.addEventListener('click', () => {
    button.classList.toggle('open');
    button.querySelector('span').textContent = button.classList.contains('open') ? '⌃' : '⌄';
    toast(`已切换至${button.textContent.replace(/[⌃⌄]/g, '').trim()}视图`);
  });
});
document.querySelector('.notify')?.addEventListener('click', (event) => {
  event.currentTarget.querySelector('em')?.remove();
  toast('目前没有新的市场提醒');
});

document.querySelector('#plan-button')?.addEventListener('click', () => {
  const budget = Math.max(1000, Number(document.querySelector('#budget')?.value || 100000));
  const risk = document.querySelector('#risk')?.value;
  window.localStorage.setItem('aurelia-budget', String(budget));
  window.localStorage.setItem('aurelia-risk', risk || 'steady');
  const weights = risk === 'active' ? [0.5, 0.3, 0.2] : risk === 'balanced' ? [0.4, 0.35, 0.25] : [0.3, 0.35, 0.35];
  ['step-one', 'step-two', 'step-three'].forEach((id, index) => {
    const value = Math.round((budget * weights[index]) / 100) * 100;
    const node = document.querySelector(`#${id}`);
    if (node) node.textContent = `¥${value.toLocaleString('zh-CN')}`;
  });
  toast('购买计划已更新');
});

document.querySelector('#recalculate')?.addEventListener('click', () => {
  const factors = [24, 21, 19, 18];
  const drift = Math.round((new Date().getMinutes() % 5) - 2);
  const score = Math.max(0, Math.min(100, factors.reduce((sum, value) => sum + value, 0) + drift));
  const confidence = document.querySelector('#confidence-value');
  const forecast = document.querySelector('#forecast-value');
  const change = document.querySelector('#forecast-change');
  if (confidence) confidence.textContent = `${score}%`;
  if (forecast) forecast.innerHTML = `$${(2684.7 * (1 + (score - 80) / 1000)).toFixed(0)} <span>预期中位</span>`;
  if (change) change.innerHTML = `+${((score - 80) / 10 + 1.69).toFixed(2)}%<small>较当前价格</small>`;
  toast(`分析完成 · 综合评分 ${score}/100`);
});
