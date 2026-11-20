// dataset/generate.js — builds the Indian delivery-rider income dataset and trains the predictor.
//   node dataset/generate.js
// Outputs (deterministic — same seed, same files):
//   dataset/riders.csv          one row per rider (profile)
//   dataset/riders_monthly.csv  one row per rider per month (36 months)
//   dataset/model.json          seasonal index per city + uncertainty + backtest accuracy
// See dataset/README.md for every assumption and its source.
const fs = require('fs');
const path = require('path');
const { forecastMonth, personalise, median, LEAN_LIMIT } = require('../predictor');

const OUT = __dirname;
const SEED = 2026, N_RIDERS = 600;
const START = { y: 2023, m: 12 }, N_MONTHS = 36;            // Dec 2023 … Nov 2026

/* ---- deterministic random numbers ---- */
let s = SEED >>> 0;
const rand = () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
const pick = arr => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => a + rand() * (b - a);

/* ---- assumptions (see README) ---- */
// Normal monthly rainfall in mm (approx. IMD climatological normals for each city's main station)
const CITIES = {
  Bengaluru: { share: .24, base: 22000, rain: [3, 7, 15, 46, 117, 106, 115, 147, 213, 168, 61, 17], heat: 0 },
  Mumbai:    { share: .18, base: 23000, rain: [1, 0, 0, 1, 12, 520, 840, 580, 330, 85, 15, 2], heat: 0 },
  Delhi:     { share: .20, base: 21000, rain: [19, 20, 15, 10, 25, 75, 210, 250, 125, 15, 5, 8], heat: .09 },
  Hyderabad: { share: .14, base: 20000, rain: [7, 5, 12, 20, 35, 110, 170, 190, 160, 100, 25, 5], heat: .06 },
  Chennai:   { share: .12, base: 19500, rain: [25, 5, 5, 15, 50, 55, 95, 125, 120, 280, 360, 140], heat: .03 },
  Pune:      { share: .12, base: 20500, rain: [1, 0, 2, 8, 30, 170, 200, 140, 135, 90, 30, 5], heat: .02 }
};
const PLATFORMS = ['Swiggy', 'Zomato', 'Zepto', 'Blinkit', 'Swiggy Instamart'];
const DIWALI = { 2023: 10, 2024: 10, 2025: 9, 2026: 10 };   // 0-based month of Diwali (Nov 12 '23, Nov 1 '24, Oct 20 '25, Nov 8 '26)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Year-to-year rainfall variation per city (some monsoons are much heavier than normal)
const rainYear = {};
for (const c in CITIES) for (const y of [2023, 2024, 2025, 2026]) rainYear[c + y] = Math.exp(0.35 * gauss());

function seasonFactor(city, y, m) {
  const C = CITIES[city], r = C.rain[m] * rainYear[city + y];
  let f = 1;
  f *= 1 - 0.35 * (1 - Math.exp(-Math.max(0, r - 60) / 300));   // heavy rain: lost working days, flooding
  if (r > 15 && r < 90) f *= 1.03;                                // light rain: more orders, rain surge pay
  if (m === 3 || m === 4) f *= 1 - C.heat;                        // Apr–May heatwaves (fewer daytime hours)
  if (m === 3 || m === 4) f *= 1.03;                              // IPL season evening orders
  if (DIWALI[y] === m) f *= 1.16;                                 // Diwali festival peak
  if (DIWALI[y] - 1 === m) f *= 1.05;                             // pre-festival (Navratri / Dussehra)
  if (m === 11) f *= 1.05;                                        // Christmas / New Year
  if (m === 1) f *= 0.97;                                         // February: 28 days
  return f;
}

/* ---- generate riders ---- */
const cityList = Object.keys(CITIES);
const riders = [], monthly = [];
for (let i = 1; i <= N_RIDERS; i++) {
  let x = rand(), city = cityList[0];
  for (const c of cityList) { x -= CITIES[c].share; if (x <= 0) { city = c; break; } }
  const fullTime = rand() < 0.7;
  const r = {
    rider_id: 'R' + String(i).padStart(4, '0'), city, platform: pick(PLATFORMS),
    vehicle: rand() < 0.85 ? 'petrol bike' : (rand() < 0.6 ? 'EV scooter' : 'bicycle'),
    type: fullTime ? 'full-time' : 'part-time', hours_per_day: fullTime ? Math.round(between(9, 12)) : Math.round(between(4, 7)),
    skill: Math.exp(0.15 * gauss()), trend: 0.03 + 0.05 * gauss()
  };
  // ~30% are inter-state migrants who go home every year for sowing (Jun–Jul), harvest (Apr) or Chhath/Diwali (Nov)
  r.hometown = rand() < 0.3 ? pick([[5, 6], [3], [10], [7, 8]]) : [];
  r.hometown_factor = between(0.35, 0.6);
  r.joined_month = rand() < 0.75 ? 0 : Math.floor(between(1, 18));   // some riders join later
  riders.push(r);
  for (let k = r.joined_month; k < N_MONTHS; k++) {
    const d = new Date(START.y, START.m - 1 + k, 1), y = d.getFullYear(), m = d.getMonth();
    let inc = CITIES[city].base * (fullTime ? 1 : 0.5) * r.skill;
    inc *= seasonFactor(city, y, m);
    inc *= 1 + r.trend * (k / 12);
    if (r.hometown.includes(m) && rand() < 0.85) inc *= r.hometown_factor;   // most years they go home
    inc *= Math.exp(0.08 * gauss());                                   // ordinary month-to-month noise
    let shock = '';
    const u = rand();
    if (u < 0.035) { inc *= between(0.35, 0.7); shock = 'illness'; }
    else if (u < 0.065) { inc *= between(0.7, 0.85); shock = 'bike repair'; }
    else if (u < 0.08) { inc *= between(0.2, 0.5); shock = 'ID blocked'; }
    else if (u < 0.09) { inc *= between(0.4, 0.7); shock = 'family event'; }
    const earnings = Math.round(inc / 10) * 10;
    const orders = Math.round(earnings / between(32, 42));
    monthly.push({ rider_id: r.rider_id, city, platform: r.platform, type: r.type, month_key: `${y}-${String(m + 1).padStart(2, '0')}`,
      month: MONTHS[m], net_earnings: earnings, orders, active_days: Math.min(31, Math.round(orders / (fullTime ? 22 : 11))),
      lean: earnings < LEAN_LIMIT ? 1 : 0, shock });
  }
}

/* ---- write CSVs ---- */
const csv = (rows, cols) => [cols.join(','), ...rows.map(r => cols.map(c => r[c]).join(','))].join('\n') + '\n';
fs.writeFileSync(path.join(OUT, 'riders.csv'), csv(riders.map(r => ({ ...r, hometown_months: r.hometown.map(m => MONTHS[m]).join('+') })), ['rider_id', 'city', 'platform', 'vehicle', 'type', 'hours_per_day', 'joined_month', 'hometown_months']));
fs.writeFileSync(path.join(OUT, 'riders_monthly.csv'), csv(monthly, ['rider_id', 'city', 'platform', 'type', 'month_key', 'month', 'net_earnings', 'orders', 'active_days', 'lean', 'shock']));

/* ---- train: seasonal index per city ---- */
// For each rider-year, income ÷ that rider's 12-month average; the median ratio per calendar month is the index.
function trainIndex(rows) {
  const by = {};
  rows.forEach(r => (by[r.rider_id] ||= []).push(r));
  const ratios = {};       // city → month → [ratio]
  for (const id in by) {
    const list = by[id];
    for (let i = 0; i + 12 <= list.length; i += 12) {
      const yr = list.slice(i, i + 12), avg = yr.reduce((a, r) => a + r.net_earnings, 0) / 12;
      yr.forEach(r => { const m = MONTHS.indexOf(r.month); for (const c of [r.city, 'all']) ((ratios[c] ||= {})[m] ||= []).push(r.net_earnings / avg); });
    }
  }
  const out = {};
  for (const c in ratios) {
    const idx = MONTHS.map((_, m) => median(ratios[c][m] || [1]));
    const mean = idx.reduce((a, b) => a + b, 0) / 12;
    out[c] = { index: idx.map(v => Math.round(v / mean * 1000) / 1000) };
  }
  // Typical monthly income of a full-time rider per city (used for brand-new users)
  for (const c in out) {
    const ft = rows.filter(r => (c === 'all' || r.city === c) && r.type === 'full-time');
    out[c].typical = Math.round(median(ft.map(r => r.net_earnings / out[c].index[MONTHS.indexOf(r.month)])));
  }
  return out;
}
const histOf = rows => rows.map(r => ({ key: r.month_key, income: r.net_earnings }));
const byRider = {}; monthly.forEach(r => (byRider[r.rider_id] ||= []).push(r));

/* ---- backtest: train on first 24 months, predict the last 12 one month ahead ---- */
const SPLIT = (() => { const d = new Date(START.y, START.m - 1 + 24, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
const trainRows = monthly.filter(r => r.month_key < SPLIT);
const trainCities = trainIndex(trainRows);
// Uncertainty: spread of log errors on the training period (months 13–24)
const logErr = [];
for (const id in byRider) {
  const rows = byRider[id].filter(r => r.month_key < SPLIT);
  rows.forEach((r, i) => { if (i < 6) return; const f = forecastMonth(histOf(rows.slice(0, i)), r.month_key, personalise(trainCities[r.city], histOf(rows.slice(0, i))), 0.2); logErr.push(Math.log(r.net_earnings / f.amount)); });
}
const mu = logErr.reduce((a, b) => a + b, 0) / logErr.length;
const sigma = Math.sqrt(logErr.reduce((a, b) => a + (b - mu) ** 2, 0) / logErr.length);

const ALERT_P = 0.3;   // the app warns when the lean probability is 30% or more
let n = 0, apeSum = 0, apes = [], tp = 0, fp = 0, fn = 0, tn = 0, naiveApe = [], seasonalLean = 0, seasonalHit = 0, cityOnlyHit = 0, cityApe = 0;
for (const id in byRider) {
  const rows = byRider[id];
  rows.forEach((r, i) => {
    if (r.month_key < SPLIT || i < 3) return;
    const past = histOf(rows.slice(0, i));
    const f = forecastMonth(past, r.month_key, personalise(trainCities[r.city], past), sigma);
    const ape = Math.abs(f.amount - r.net_earnings) / r.net_earnings;
    apes.push(ape); apeSum += ape; n++;
    const f2 = forecastMonth(past, r.month_key, trainCities[r.city], sigma);   // comparison: city pattern only, no personalisation
    cityApe += Math.abs(f2.amount - r.net_earnings) / r.net_earnings;
    naiveApe.push(Math.abs(rows[i - 1].net_earnings - r.net_earnings) / r.net_earnings);   // baseline: "same as last month"
    if (r.type !== 'full-time') return;                                  // lean detection scored on full-time riders (our target user)
    const pred = f.pLean >= ALERT_P, act = r.lean === 1;
    if (act && !r.shock) { seasonalLean++; if (pred) seasonalHit++; }   // lean months not caused by a random personal shock
    if (act && f2.pLean >= ALERT_P) cityOnlyHit++;
    if (pred && act) tp++; else if (pred) fp++; else if (act) fn++; else tn++;
  });
}
const pctR = x => Math.round(x * 1000) / 10;
const backtest = {
  method: 'Train on Dec 2023–Nov 2025, predict each month of Dec 2025–Nov 2026 one month ahead',
  predictions: n, mape: pctR(apeSum / n), medianApe: pctR(median(apes)), naiveMape: pctR(naiveApe.reduce((a, b) => a + b, 0) / naiveApe.length),
  leanRecall: pctR(tp / (tp + fn)), cityOnlyMape: pctR(cityApe / n), cityOnlyLeanRecall: pctR(cityOnlyHit / (tp + fn)), leanPrecision: pctR(tp / (tp + fp)), accuracy: pctR((tp + tn) / (tp + tn + fp + fn)), alertThreshold: ALERT_P, seasonalLeanRecall: pctR(seasonalHit / seasonalLean), leanMonths: tp + fn, fullTimeMonths: tp + tn + fp + fn
};

/* ---- final model: trained on all 36 months ---- */
const cities = trainIndex(monthly);
const model = {
  version: 1, generated: 'seed ' + SEED, riders: N_RIDERS, months: N_MONTHS, cityNames: cityList,
  source: 'Simulated Indian delivery riders (6 cities, 36 months) calibrated to IMD rainfall normals, festival calendar and published gig-earnings ranges — see dataset/README.md',
  sigma: Math.round(sigma * 1000) / 1000, cities, backtest
};
fs.writeFileSync(path.join(OUT, 'model.json'), JSON.stringify(model, null, 1));

const leanShare = pctR(monthly.filter(r => r.lean).length / monthly.length);
console.log(`riders: ${N_RIDERS}, rider-months: ${monthly.length}, lean months: ${leanShare}%`);
console.log('sigma', model.sigma, 'backtest', backtest);
for (const c of cityList) console.log(c.padEnd(10), cities[c].index.map(v => v.toFixed(2)).join(' '), 'typical ₹' + cities[c].typical);
