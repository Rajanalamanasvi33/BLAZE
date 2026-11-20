// predictor.js — Lean Month Predictor, Early Warning Alerts and Surplus Plan.
// The model (seasonal index per city + uncertainty) is learned from dataset/riders_monthly.csv
// by dataset/generate.js and stored in dataset/model.json.
const fs = require('fs');
const path = require('path');

const LEAN_LIMIT = 15000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MODEL_FILE = path.join(__dirname, 'dataset', 'model.json');
let MODEL = null;
function model() { return MODEL || (MODEL = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8'))); }

/* ---------- small maths helpers ---------- */
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// Standard normal CDF (Abramowitz–Stegun approximation, error < 1e-7)
function phi(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
const keyAdd = (key, n) => { const [y, m] = key.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const monthIdx = key => Number(key.slice(5, 7)) - 1;
const labelOf = key => `${MONTHS[monthIdx(key)]} '${key.slice(2, 4)}`;

/** Pick the model city that matches a free-text city, else the all-India pattern. */
function cityModel(city, m = model()) {
  const c = String(city || '').toLowerCase();
  const alias = { bangalore: 'bengaluru', bombay: 'mumbai', 'new delhi': 'delhi', gurgaon: 'delhi', gurugram: 'delhi', noida: 'delhi', madras: 'chennai', secunderabad: 'hyderabad' };
  const name = Object.keys(m.cities).find(k => k !== 'all' && (c.includes(k.toLowerCase()) || alias[c] === k.toLowerCase()));
  return { name: name || 'all', ...m.cities[name || 'all'] };
}

/**
 * Learn the worker's OWN seasonal pattern once they have 12+ months of history, and blend it with the
 * city pattern. One past year of a month gets 50% weight, two years 67% (shrinkage against one-off shocks).
 */
function personalise(cm, history) {
  const h = history.filter(x => x.income > 0).slice(-24);
  if (h.length < 12) return { ...cm, personal: false };
  const deseason = h.map(x => x.income / cm.index[monthIdx(x.key)]);
  const level = median(deseason);
  const index = cm.index.map((c, m) => {
    const r = h.filter(x => monthIdx(x.key) === m).map(x => x.income / level);
    if (!r.length) return c;
    const w = r.length / (r.length + 1);
    return w * (r.reduce((a, b) => a + b, 0) / r.length) + (1 - w) * c;
  });
  return { ...cm, index, personal: true };
}

/**
 * Forecast one month.
 * history: [{ key:'YYYY-MM', income }] of COMPLETED months, oldest first.
 * Personal baseline = median of the last 6 de-seasonalised months (robust to one-off shocks),
 * blended with the city's typical rider income while history is short.
 */
function forecastMonth(history, targetKey, cm, sigma) {
  const recent = history.filter(h => h.income > 0 && h.key < targetKey).slice(-6);
  const deseason = recent.map(h => h.income / cm.index[monthIdx(h.key)]);
  const w = Math.min(recent.length, 3) / 3;
  const baseline = w * median(deseason) + (1 - w) * cm.typical;
  const amount = baseline * cm.index[monthIdx(targetKey)];
  const pLean = phi((Math.log(LEAN_LIMIT) - Math.log(amount)) / sigma);
  return { key: targetKey, label: labelOf(targetKey), amount: Math.round(amount),
    low: Math.round(amount * Math.exp(-1.2816 * sigma)), high: Math.round(amount * Math.exp(1.2816 * sigma)),
    pLean: Math.round(pLean * 100) / 100, lean: pLean >= 0.5, baseline: Math.round(baseline) };
}

/**
 * Full insight bundle for one user.
 * u: { city, monthKey, monthIncome, history:[{key,income}], totalExpenses, spent, leanBal, emerBal, leanTarget, emerTarget, today:Date }
 */
function buildInsights(u) {
  const m = model(), sigma = m.sigma;
  const done = u.history.filter(h => h.key < u.monthKey);
  const cm = personalise(cityModel(u.city, m), done);
  const thisMonth = forecastMonth(done, u.monthKey, cm, sigma);
  // Next 12 months, feeding each forecast back as history (recursive forecasting)
  const outlook = []; let hist = [...done, { key: u.monthKey, income: Math.max(u.monthIncome, thisMonth.amount) }];
  for (let i = 1; i <= 12; i++) {
    const f = forecastMonth(hist, keyAdd(u.monthKey, i), cm, sigma);
    outlook.push(f); hist = [...hist, { key: f.key, income: f.amount }];
  }

  const exp = u.totalExpenses, today = u.today || new Date();
  const day = today.getDate(), dim = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const pace = day >= 5 ? Math.round(u.monthIncome / day * dim) : null;
  const alerts = [];

  // 1. Slow month so far
  if (pace !== null && pace < LEAN_LIMIT)
    alerts.push({ id: 'pace', level: 'danger', icon: 'trend', title: 'Slow month so far',
      text: `At this pace you'll earn about ₹${pace.toLocaleString('en-IN')} this month — below the ₹15,000 lean line. Plan to use your Lean Fund.` });

  // 2. Next month likely lean
  const next = outlook[0];
  if (next.pLean >= 0.3)
    alerts.push({ id: 'next', level: 'danger', icon: 'alert', title: `${next.label} looks lean`,
      text: `Predicted ₹${next.amount.toLocaleString('en-IN')} (${Math.round(next.pLean * 100)}% chance of a lean month). Save extra this month.` });

  // 3. Lean season ahead → how much to save per month
  const risky = outlook.filter(f => f.pLean >= 0.3);
  let seasonPlan = null;
  if (risky.length) {
    // Shortfall = how far income is expected to fall below the worker's usual month
    const usual = Math.max(LEAN_LIMIT, median(done.slice(-12).map(h => h.income)) || thisMonth.amount);
    const gap = Math.round(risky.reduce((s, f) => s + Math.max(0, usual - f.amount), 0) / 100) * 100;
    const need = Math.max(0, gap - u.leanBal);
    const monthsLeft = Math.max(1, outlook.indexOf(risky[0]));
    seasonPlan = { months: risky.map(f => f.label), usual: Math.round(usual), gap, need, perMonth: Math.ceil(need / monthsLeft / 100) * 100, firstIn: monthsLeft };
    if (risky[0] !== next)
      alerts.push({ id: 'season', level: need > 0 ? 'warn' : 'ok', icon: 'calendar', title: `Lean season: ${risky.map(f => f.label.split(' ')[0]).join(', ')}`,
        text: need > 0 ? `Income usually drops by ₹${gap.toLocaleString('en-IN')} in these months; your Lean Fund is ₹${u.leanBal.toLocaleString('en-IN')}. Save ₹${seasonPlan.perMonth.toLocaleString('en-IN')}/month into the Lean Fund for the next ${monthsLeft} month${monthsLeft > 1 ? 's' : ''}.`
          : `Your Lean Fund (₹${u.leanBal.toLocaleString('en-IN')}) already covers the expected ₹${gap.toLocaleString('en-IN')} drop.` });
  }

  // 4. Bills not yet covered this month
  const unpaid = Math.max(0, exp - u.spent), cashLeft = u.monthIncome - u.spent;
  if (unpaid > 0 && cashLeft < unpaid)
    alerts.push({ id: 'bills', level: 'warn', icon: 'doc', title: 'Bills not covered yet',
      text: `₹${unpaid.toLocaleString('en-IN')} of fixed bills are still unpaid and you're ₹${(unpaid - cashLeft).toLocaleString('en-IN')} short this month.` });

  // 5. Runway: how long buffers last with zero income
  const runwayDays = exp > 0 ? Math.floor((u.leanBal + u.emerBal) / (exp / 30)) : null;
  if (runwayDays !== null && runwayDays < 45)
    alerts.push({ id: 'runway', level: runwayDays < 20 ? 'danger' : 'warn', icon: 'life', title: `Buffers last ${runwayDays} days`,
      text: `If income stopped today, your savings would cover fixed costs for about ${runwayDays} days. Aim for 90.` });

  // 6. Emergency fund thin
  if (exp > 0 && u.emerBal < exp)
    alerts.push({ id: 'emer', level: 'warn', icon: 'shield', title: 'Emergency Fund is thin',
      text: `It covers less than one month of fixed costs (₹${exp.toLocaleString('en-IN')}). Top it up in your next good week.` });

  // 7. Good month → surplus plan
  const expected = thisMonth.amount, surplusAmt = Math.round(u.monthIncome - expected - (u.surplusUsed || 0));   // minus what was already moved
  let surplus = null;
  if (surplusAmt >= 2000 && u.monthIncome - (u.surplusUsed || 0) > expected * 1.1) {
    let left = surplusAmt; const steps = [];
    const take = (id, label, why, want) => { const a = Math.max(0, Math.floor(Math.min(left, want) / 100) * 100); if (a > 0) { steps.push({ id, label, why, amount: a }); left -= a; } };
    const enjoy = Math.floor(surplusAmt * 0.2 / 100) * 100;
    left -= enjoy;
    take('emer', 'Emergency Fund', 'Safety net first — up to 3 months of fixed costs', Math.min(u.emerTarget, exp * 3) - u.emerBal);
    take('lean', 'Lean Fund', seasonPlan ? `Covers the coming lean season (${seasonPlan.months.join(', ')})` : 'Cushion for slow months', Math.max((seasonPlan?.need || 0), u.leanTarget - u.leanBal));
    take('goal', 'Goal savings', 'Low-risk savings such as a bank RD or PPF', left);
    steps.push({ id: 'enjoy', label: 'Yours to enjoy', why: 'Guilt-free spending — you earned it', amount: enjoy + left });
    surplus = { amount: surplusAmt, expected, steps };
    alerts.unshift({ id: 'good', level: 'ok', icon: 'trend', title: 'Great month!',
      text: `You've earned ₹${surplusAmt.toLocaleString('en-IN')} more than expected. See your surplus plan below.` });
  }

  const order = { danger: 0, warn: 1, ok: 2 };
  alerts.sort((a, b) => (a.id === 'good' ? -1 : b.id === 'good' ? 1 : order[a.level] - order[b.level]));
  return { city: cm.name, personal: cm.personal, seasonIndex: cm.index.map(v => Math.round(v * 100) / 100), thisMonth, pace, outlook, seasonPlan, alerts, surplus, runwayDays,
    model: { riders: m.riders, months: m.months, cities: m.cityNames, backtest: m.backtest, source: m.source } };
}

module.exports = { buildInsights, forecastMonth, personalise, cityModel, phi, median, keyAdd, monthIdx, LEAN_LIMIT, MODEL_FILE };
