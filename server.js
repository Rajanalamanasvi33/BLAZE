// server.js — Finance Guru backend (Express + SQLite + signed-token auth)
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { db, tx, DATA_DIR } = require('./db');
const { buildInsights } = require('./predictor');
const { parseSms, sampleInbox } = require('./sms');

const PORT = Number(process.env.PORT) || 3000;
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000; // 30 days
const LEAN_LIMIT = 15000;
const WORKER_TYPES = ['delivery', 'driver', 'construction', 'domestic', 'vendor', 'other'];

/* ------------------------------------------------------------------ */
/* Secret for signing tokens: env var, else generated once and stored */
/* ------------------------------------------------------------------ */
const SECRET = process.env.FG_SECRET || (() => {
  const f = path.join(DATA_DIR, '.secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
})();

/* ------------------------------ Helpers ---------------------------- */
const pad = n => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const monthKeyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = msg => { throw new ApiError(400, msg); };

function amountOf(v, { min = 1, max = 10000000, field = 'amount' } = {}) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) bad(`${field} must be between ${min} and ${max}`);
  return n;
}
function text(v, { max = 80, required = false, field = 'text' } = {}) {
  const s = String(v ?? '').trim().slice(0, max);
  if (required && !s) bad(`${field} is required`);
  return s;
}
const fundOf = f => (f === 'lean' || f === 'emer') ? f : bad('fund must be "lean" or "emer"');

/* Business rule: same formula the client shows */
function calcSafeToSpend(inc, exp) {
  const pct = inc > 20000 ? 0.15 : inc > 15000 ? 0.10 : 0;
  const save = Math.round(inc * pct);
  return { safe: Math.max(0, inc - exp - save), save, pct, inc, exp };
}

/* ------------------------------ Auth ------------------------------- */
function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') };
}
function checkPassword(pw, salt, hash) {
  const a = Buffer.from(hashPassword(pw, salt).hash, 'hex'), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function signToken(userId) {
  const body = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyToken(tok) {
  const [body, sig] = String(tok || '').split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p.uid : null; }
  catch { return null; }
}
function requireAuth(req, res, next) {
  const uid = verifyToken((req.get('authorization') || '').replace(/^Bearer\s+/i, ''));
  const user = uid && db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  if (!user) return res.status(401).json({ error: 'Please log in again' });
  req.user = user;
  next();
}

/* Simple in-memory rate limit for login/register (per IP) */
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now(), k = req.ip, h = hits.get(k) || { n: 0, reset: now + 15 * 60 * 1000 };
  if (now > h.reset) { h.n = 0; h.reset = now + 15 * 60 * 1000; }
  if (++h.n > 30) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  hits.set(k, h); next();
}

/* ---------------------- Month rollover (server-side) ---------------- */
function rolloverIfNeeded(user) {
  const nowKey = monthKeyOf(new Date());
  if (user.month_key === nowKey) return null;
  const [y, m] = user.month_key.split('-').map(Number);
  const mk = user.month_key, uid = user.id;
  const sum = (sql, ...a) => db.prepare(sql).get(...a).s;
  const paid = sum(`SELECT COALESCE(SUM(amount),0) s FROM activity WHERE user_id=? AND type='expense' AND substr(date,1,7)=?`, uid, mk);
  const leanDep = sum(`SELECT COALESCE(SUM(amount),0) s FROM buffer_tx WHERE user_id=? AND fund='lean' AND kind='dep' AND substr(date,1,7)=?`, uid, mk);
  const emerDep = sum(`SELECT COALESCE(SUM(amount),0) s FROM buffer_tx WHERE user_id=? AND fund='emer' AND kind='dep' AND substr(date,1,7)=?`, uid, mk);
  const saved = leanDep + emerDep;
  const wrapUp = { monthKey: mk, label: `${MONTHS[m - 1]} ${y}`, income: user.month_income, saved, paid };
  tx(() => {
    db.prepare(`INSERT INTO history (user_id, month_key, month, year, income, saved, lean_dep, emer_dep)
                VALUES (?,?,?,?,?,?,?,?)
                ON CONFLICT(user_id, month_key) DO UPDATE SET income=excluded.income, saved=excluded.saved,
                  lean_dep=excluded.lean_dep, emer_dep=excluded.emer_dep`)
      .run(uid, mk, MONTHS[m - 1], String(y).slice(2), user.month_income, saved, leanDep, emerDep);
    db.prepare('DELETE FROM income WHERE user_id=?').run(uid);           // incomeLog resets each month
    db.prepare('UPDATE users SET month_income=0, month_key=? WHERE id=?').run(nowKey, uid); // buffers kept
  });
  return wrapUp;
}

/* ------------------- Build the STATE object the app uses ----------- */
function buildState(uid) {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  const expenses = db.prepare('SELECT id, name, amount, icon, active FROM expenses WHERE user_id=? ORDER BY id').all(uid)
    .map(e => ({ ...e, active: !!e.active }));
  const totalExpenses = expenses.filter(e => e.active).reduce((s, e) => s + e.amount, 0);
  return {
    onboarded: true,
    username: u.username, name: u.name, city: u.city, workerType: u.worker_type,
    expenses, totalExpenses,
    monthIncome: u.month_income,
    incomeLog: db.prepare('SELECT id, date, amount, note FROM income WHERE user_id=? ORDER BY date, id').all(uid),
    leanBal: u.lean_bal, leanTarget: u.lean_target, emerBal: u.emer_bal, emerTarget: u.emer_target,
    history: db.prepare(`SELECT month, year, income, saved, lean_dep AS leanDep, emer_dep AS emerDep
                         FROM (SELECT * FROM history WHERE user_id=? ORDER BY month_key DESC LIMIT 24) ORDER BY month_key`).all(uid),
    activity: db.prepare('SELECT id, date, type, amount, note, icon FROM activity WHERE user_id=? ORDER BY date DESC, id DESC LIMIT 50').all(uid),
    bufferTx: db.prepare('SELECT id, fund, kind, amount, note, date FROM buffer_tx WHERE user_id=? ORDER BY date DESC, id DESC LIMIT 50').all(uid),
    monthKey: u.month_key,
    summary: calcSafeToSpend(u.month_income, totalExpenses),
    insights: insightsFor(u, totalExpenses)
  };
}
function insightsFor(u, totalExpenses) {
  const spent = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM activity WHERE user_id=? AND type='expense' AND substr(date,1,7)=?`).get(u.id, u.month_key).s;
  return buildInsights({
    city: u.city, monthKey: u.month_key, monthIncome: u.month_income, totalExpenses, spent,
    history: db.prepare('SELECT month_key AS key, income FROM history WHERE user_id=? ORDER BY month_key').all(u.id),
    surplusUsed: db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM buffer_tx WHERE user_id=? AND kind='dep' AND note='Surplus plan' AND substr(date,1,7)=?`).get(u.id, u.month_key).s,
    leanBal: u.lean_bal, emerBal: u.emer_bal, leanTarget: u.lean_target, emerTarget: u.emer_target, today: new Date()
  });
}
const send = (res, uid, extra = {}) => res.json({ state: buildState(uid), ...extra });
const addActivity = (uid, type, amount, note, icon) =>
  db.prepare('INSERT INTO activity (user_id, date, type, amount, note, icon) VALUES (?,?,?,?,?,?)').run(uid, todayISO(), type, amount, note, icon);

/* ----------------------------- Seed data --------------------------- */
const DEFAULT_EXPENSES = [['Rent', 5000, 'home'], ['Groceries', 3000, 'cart'], ['Phone Bill', 399, 'phone']];

function seedDemo(uid) {
  const nowKey = monthKeyOf(new Date());
  tx(() => {
    for (const t of ['income', 'expenses', 'activity', 'buffer_tx', 'history', 'sms_seen']) db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(uid);
    db.prepare(`UPDATE users SET name='Raju', city='Bengaluru', worker_type='delivery', month_income=23400,
                lean_bal=12400, lean_target=30000, emer_bal=8200, emer_target=15000, month_key=? WHERE id=?`).run(nowKey, uid);
    const ie = db.prepare('INSERT INTO expenses (user_id, name, amount, icon, active) VALUES (?,?,?,?,1)');
    [['Rent', 5500, 'home'], ['Groceries', 3000, 'cart'], ['Phone Bill', 399, 'phone'], ['Fuel', 800, 'fuel'], ['EMI', 1800, 'doc'], ['Electricity', 600, 'bulb']]
      .forEach(([n, a, i]) => ie.run(uid, n, a, i));
    const ii = db.prepare('INSERT INTO income (user_id, date, amount, note) VALUES (?,?,?,?)');
    [['2026-11-18', 1200, 'Evening deliveries'], ['2026-11-19', 980, 'Morning + afternoon'], ['2026-11-20', 1150, '']].forEach(r => ii.run(uid, ...r));
    const ih = db.prepare('INSERT INTO history (user_id, month_key, month, year, income, saved, lean_dep, emer_dep) VALUES (?,?,?,?,?,?,?,?)');
    [['2024-12', 23900, 3585, 0], ['2025-01', 22100, 3315, 0], ['2025-02', 21400, 3210, 0], ['2025-03', 23800, 3570, 0],
     ['2025-04', 24600, 3690, 0], ['2025-05', 22300, 3345, 0], ['2025-06', 21900, 3285, 0], ['2025-07', 20800, 3120, 0],
     ['2025-08', 13900, 0, 0], ['2025-09', 12600, 0, 0], ['2025-10', 25900, 3885, 0], ['2025-11', 24200, 3630, 0],
     ['2025-12', 10200, 0, 9000], ['2026-01', 22400, 3360, 0], ['2026-02', 24800, 3720, 0], ['2026-03', 26200, 3930, 0],
     ['2026-04', 23100, 3465, 0], ['2026-05', 21800, 2180, 0], ['2026-06', 24500, 3675, 0], ['2026-07', 27800, 4170, 0],
     ['2026-08', 9200, 0, 9200], ['2026-09', 11500, 0, 8000], ['2026-10', 23400, 3510, 0], ['2026-11', 23400, 3510, 0]]
      .forEach(([k, inc, sv, ld]) => { const [y, m] = k.split('-'); ih.run(uid, k, MONTHS[+m - 1], y.slice(2), inc, sv, ld, 0); });
    const ia = db.prepare('INSERT INTO activity (user_id, date, type, amount, note, icon) VALUES (?,?,?,?,?,?)');
    [['2026-11-01', 'expense', 5500, 'Rent paid', 'home'], ['2026-11-15', 'buffer_save', 3510, 'Monthly savings', 'shield'],
     ['2026-11-18', 'income', 1200, 'Evening deliveries', 'receive'], ['2026-11-19', 'income', 980, 'Morning shift', 'receive'],
     ['2026-11-20', 'income', 1150, 'Deliveries', 'receive']].forEach(r => ia.run(uid, ...r));
    const ib = db.prepare('INSERT INTO buffer_tx (user_id, fund, kind, amount, note, date) VALUES (?,?,?,?,?,?)');
    [['emer', 'dep', 6200, 'Initial deposit', '2026-07-30'], ['lean', 'wd', 8000, 'Rent shortfall (Sep)', '2026-09-05'],
     ['emer', 'dep', 2000, 'Top-up', '2026-10-20'], ['lean', 'dep', 3510, 'October savings', '2026-10-28'],
     ['lean', 'dep', 3510, 'Monthly savings', '2026-11-15']].forEach(r => ib.run(uid, ...r));
  });
}

/* ------------------------------ App -------------------------------- */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});
const wrap = fn => (req, res, next) => { try { fn(req, res, next); } catch (e) { next(e); } };

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

/* ---- Auth ---- */
app.post('/api/auth/register', rateLimit, wrap((req, res) => {
  const username = text(req.body.username, { max: 30, required: true, field: 'Username' }).toLowerCase();
  if (!/^[a-z0-9_.]{3,30}$/.test(username)) bad('Username: 3–30 letters, numbers, _ or .');
  const password = String(req.body.password || '');
  if (password.length < 6) bad('Password must be at least 6 characters');
  const name = text(req.body.name, { max: 40, required: true, field: 'Name' });
  const city = text(req.body.city, { max: 40 });
  const wt = WORKER_TYPES.includes(req.body.workerType) ? req.body.workerType : 'other';
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) throw new ApiError(409, 'Username already taken');
  const { salt, hash } = hashPassword(password);
  const uid = tx(() => {
    const r = db.prepare(`INSERT INTO users (username, pass_hash, salt, name, city, worker_type, month_key) VALUES (?,?,?,?,?,?,?)`)
      .run(username, hash, salt, name, city, wt, monthKeyOf(new Date()));
    const id = Number(r.lastInsertRowid);
    const ie = db.prepare('INSERT INTO expenses (user_id, name, amount, icon) VALUES (?,?,?,?)');
    DEFAULT_EXPENSES.forEach(([n, a, i]) => ie.run(id, n, a, i));
    return id;
  });
  res.status(201).json({ token: signToken(uid), state: buildState(uid) });
}));

app.post('/api/auth/login', rateLimit, wrap((req, res) => {
  const username = text(req.body.username, { max: 30, required: true, field: 'Username' }).toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!u || !checkPassword(String(req.body.password || ''), u.salt, u.pass_hash)) throw new ApiError(401, 'Wrong username or password');
  const wrapUp = rolloverIfNeeded(u);
  res.json({ token: signToken(u.id), state: buildState(u.id), wrapUp });
}));

// One-tap demo: creates (or resets) the "raju" demo account
app.post('/api/auth/demo', rateLimit, wrap((req, res) => {
  let u = db.prepare("SELECT id FROM users WHERE username='raju'").get();
  if (!u) {
    const { salt, hash } = hashPassword('raju123');
    const r = db.prepare(`INSERT INTO users (username, pass_hash, salt, name, month_key) VALUES ('raju',?,?,'Raju',?)`)
      .run(hash, salt, monthKeyOf(new Date()));
    u = { id: Number(r.lastInsertRowid) };
  }
  seedDemo(u.id);
  res.json({ token: signToken(u.id), state: buildState(u.id) });
}));

/* ---- Everything below needs a valid token ---- */
const api = express.Router();
api.use(requireAuth);

// Full state (also performs month rollover)
api.get('/state', wrap((req, res) => send(res, req.user.id, { wrapUp: rolloverIfNeeded(req.user) })));

// Safe-to-spend summary only
api.get('/summary', wrap((req, res) => res.json(buildState(req.user.id).summary)));

/* Income */
api.post('/income', wrap((req, res) => {
  const amt = amountOf(req.body.amount), note = text(req.body.note);
  tx(() => {
    db.prepare('INSERT INTO income (user_id, date, amount, note) VALUES (?,?,?,?)').run(req.user.id, todayISO(), amt, note);
    db.prepare('UPDATE users SET month_income = month_income + ? WHERE id=?').run(amt, req.user.id);
    addActivity(req.user.id, 'income', amt, note || 'Income logged', 'receive');
  });
  res.status(201); send(res, req.user.id);
}));
api.delete('/income/:id', wrap((req, res) => {
  const row = db.prepare('SELECT * FROM income WHERE id=? AND user_id=?').get(Number(req.params.id), req.user.id);
  if (!row) throw new ApiError(404, 'Entry not found');
  tx(() => {
    db.prepare('DELETE FROM income WHERE id=?').run(row.id);
    db.prepare('UPDATE users SET month_income = MAX(0, month_income - ?) WHERE id=?').run(row.amount, req.user.id);
  });
  send(res, req.user.id);
}));

/* Expenses */
api.post('/expenses', wrap((req, res) => {
  const name = text(req.body.name, { max: 40, required: true, field: 'Name' });
  const amt = amountOf(req.body.amount), icon = text(req.body.icon, { max: 8 }) || 'send';
  db.prepare('INSERT INTO expenses (user_id, name, amount, icon) VALUES (?,?,?,?)').run(req.user.id, name, amt, icon);
  res.status(201); send(res, req.user.id);
}));
api.patch('/expenses/:id', wrap((req, res) => {
  const e = db.prepare('SELECT * FROM expenses WHERE id=? AND user_id=?').get(Number(req.params.id), req.user.id);
  if (!e) throw new ApiError(404, 'Expense not found');
  const name = req.body.name !== undefined ? text(req.body.name, { max: 40, required: true, field: 'Name' }) : e.name;
  const amount = req.body.amount !== undefined ? amountOf(req.body.amount, { min: 0 }) : e.amount;
  const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : e.active;
  db.prepare('UPDATE expenses SET name=?, amount=?, active=? WHERE id=?').run(name, amount, active, e.id);
  send(res, req.user.id);
}));
api.delete('/expenses/:id', wrap((req, res) => {
  const r = db.prepare('DELETE FROM expenses WHERE id=? AND user_id=?').run(Number(req.params.id), req.user.id);
  if (!r.changes) throw new ApiError(404, 'Expense not found');
  send(res, req.user.id);
}));
// Mark an expense (or a custom amount) as paid
api.post('/expenses/pay', wrap((req, res) => {
  const amt = amountOf(req.body.amount);
  let note = text(req.body.note, { max: 60 }) || 'Expense', icon = 'send';
  if (req.body.expenseId) {
    const e = db.prepare('SELECT * FROM expenses WHERE id=? AND user_id=?').get(Number(req.body.expenseId), req.user.id);
    if (e && e.name === note) icon = e.icon;
  }
  addActivity(req.user.id, 'expense', amt, note + ' paid', icon);
  res.status(201); send(res, req.user.id);
}));

/* Buffers */
api.post('/buffers/:fund/deposit', wrap((req, res) => {
  const fund = fundOf(req.params.fund), amt = amountOf(req.body.amount), col = fund === 'lean' ? 'lean_bal' : 'emer_bal';
  const label = fund === 'lean' ? 'Lean Fund' : 'Emergency Fund';
  tx(() => {
    db.prepare(`UPDATE users SET ${col} = ${col} + ? WHERE id=?`).run(amt, req.user.id);
    db.prepare('INSERT INTO buffer_tx (user_id, fund, kind, amount, note, date) VALUES (?,?,?,?,?,?)')
      .run(req.user.id, fund, 'dep', amt, text(req.body.note, { max: 60 }) || 'Deposit', todayISO());
    addActivity(req.user.id, 'buffer_save', amt, 'Saved to ' + label, 'shield');
  });
  res.status(201); send(res, req.user.id);
}));
api.post('/buffers/:fund/withdraw', wrap((req, res) => {
  const fund = fundOf(req.params.fund), amt = amountOf(req.body.amount), col = fund === 'lean' ? 'lean_bal' : 'emer_bal';
  const reason = text(req.body.reason, { max: 60, required: true, field: 'Reason' });
  tx(() => {
    // Atomic balance check: only succeeds if enough money is in the fund
    const r = db.prepare(`UPDATE users SET ${col} = ${col} - ? WHERE id=? AND ${col} >= ?`).run(amt, req.user.id, amt);
    if (!r.changes) bad('Amount is more than the available balance');
    db.prepare('INSERT INTO buffer_tx (user_id, fund, kind, amount, note, date) VALUES (?,?,?,?,?,?)')
      .run(req.user.id, fund, 'wd', amt, reason, todayISO());
    addActivity(req.user.id, 'buffer_draw', amt, 'Drew: ' + reason, 'draw');
  });
  res.status(201); send(res, req.user.id);
}));

/* Profile & settings */
/* SMS import (Android app forwards bank SMS; web demo uses a sample inbox or pasted text) */
const smsList = body => {
  const list = Array.isArray(body.messages) ? body.messages : bad('messages must be a list');
  if (list.length < 1 || list.length > 50) bad('Send 1–50 messages');
  return list.map(m => ({ sender: String(m?.sender || '').slice(0, 40), text: String(m?.text || '').slice(0, 500) }));
};
const smsHash = (uid, p) => crypto.createHash('sha256').update(uid + '|' + p.ref + '|' + p.amount).digest('hex');
api.get('/sms/sample', wrap((req, res) => res.json({ messages: sampleInbox() })));
api.post('/sms/preview', wrap((req, res) => {
  const seen = db.prepare('SELECT 1 FROM sms_seen WHERE user_id=? AND hash=?'), mk = req.user.month_key;
  res.json({ items: smsList(req.body).map(m => {
    const p = parseSms(m.text, m.sender, todayISO());
    if (p.status === 'ok' && seen.get(req.user.id, smsHash(req.user.id, p))) return { ...p, status: 'duplicate', reason: 'Already imported' };
    if (p.status === 'ok' && p.date.slice(0, 7) !== mk) return { ...p, status: 'ignored', reason: 'Not from this month' };
    return p;
  }) });
}));
api.post('/sms/import', wrap((req, res) => {
  const uid = req.user.id, mk = req.user.month_key, out = { added: 0, income: 0, spent: 0, ignored: 0, duplicates: 0 };
  tx(() => {
    for (const m of smsList(req.body)) {
      const p = parseSms(m.text, m.sender, todayISO());
      if (p.status !== 'ok' || p.date.slice(0, 7) !== mk) { out.ignored++; continue; }
      const r = db.prepare('INSERT OR IGNORE INTO sms_seen (user_id, hash, date) VALUES (?,?,?)').run(uid, smsHash(uid, p), todayISO());
      if (!r.changes) { out.duplicates++; continue; }
      const note = `${p.merchant} · SMS`.slice(0, 80);
      if (p.type === 'income') {
        db.prepare('INSERT INTO income (user_id, date, amount, note) VALUES (?,?,?,?)').run(uid, p.date, p.amount, note);
        db.prepare('UPDATE users SET month_income = month_income + ? WHERE id=?').run(p.amount, uid);
        db.prepare('INSERT INTO activity (user_id, date, type, amount, note, icon) VALUES (?,?,?,?,?,?)').run(uid, p.date, 'income', p.amount, note, 'receive');
        out.income += p.amount;
      } else {
        db.prepare('INSERT INTO activity (user_id, date, type, amount, note, icon) VALUES (?,?,?,?,?,?)').run(uid, p.date, 'expense', p.amount, `${p.category}: ${p.merchant}`.slice(0, 80), p.icon);
        out.spent += p.amount;
      }
      out.added++;
    }
  });
  send(res, uid, { result: out });
}));

/* Forecast, alerts and surplus plan */
api.get('/insights', wrap((req, res) => res.json(buildState(req.user.id).insights)));

api.put('/settings', wrap((req, res) => {
  const u = req.user;
  const name = req.body.name !== undefined ? text(req.body.name, { max: 40, required: true, field: 'Name' }) : u.name;
  const city = req.body.city !== undefined ? text(req.body.city, { max: 40 }) : u.city;
  const wt = WORKER_TYPES.includes(req.body.workerType) ? req.body.workerType : u.worker_type;
  const lt = req.body.leanTarget !== undefined ? amountOf(req.body.leanTarget, { field: 'Lean target' }) : u.lean_target;
  const et = req.body.emerTarget !== undefined ? amountOf(req.body.emerTarget, { field: 'Emergency target' }) : u.emer_target;
  db.prepare('UPDATE users SET name=?, city=?, worker_type=?, lean_target=?, emer_target=? WHERE id=?').run(name, city, wt, lt, et, u.id);
  send(res, u.id);
}));

// Export everything for this user as JSON
api.get('/export', wrap((req, res) => {
  const s = buildState(req.user.id);
  res.set('Content-Disposition', 'attachment; filename="finance-guru-export.json"').json({ exportedAt: new Date().toISOString(), ...s });
}));

// Wipe this user's data (keeps the account)
api.post('/reset', wrap((req, res) => {
  const uid = req.user.id;
  tx(() => {
    for (const t of ['income', 'expenses', 'activity', 'buffer_tx', 'history', 'sms_seen']) db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(uid);
    db.prepare('UPDATE users SET month_income=0, lean_bal=0, emer_bal=0, lean_target=30000, emer_target=15000, month_key=? WHERE id=?')
      .run(monthKeyOf(new Date()), uid);
    const ie = db.prepare('INSERT INTO expenses (user_id, name, amount, icon) VALUES (?,?,?,?)');
    DEFAULT_EXPENSES.forEach(([n, a, i]) => ie.run(uid, n, a, i));
  });
  send(res, uid);
}));

// Delete the account entirely
api.delete('/account', wrap((req, res) => {
  db.prepare('DELETE FROM users WHERE id=?').run(req.user.id);
  res.json({ ok: true });
}));

app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

/* ---- Frontend ---- */
app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
// Android app download (built from mobile/, see mobile/README.md)
app.get('/download/FinanceGuru.apk', (req, res) => {
  res.set('Content-Type', 'application/vnd.android.package-archive');
  res.download(path.join(__dirname, 'downloads', 'FinanceGuru.apk'), 'FinanceGuru.apk');
});

/* ---- Errors ---- */
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (err instanceof ApiError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Finance Guru running at http://localhost:${PORT}`));
}
module.exports = { app, calcSafeToSpend, LEAN_LIMIT };
