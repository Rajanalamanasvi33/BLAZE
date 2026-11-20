// test.js — end-to-end API tests. Run: npm test  (uses a throwaway database)
const os = require('os'), fs = require('fs'), path = require('path'), assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-test-'));
process.env.DATA_DIR = tmp;
const { app } = require('./server');

let base, token, passed = 0;
async function call(method, p, body, tok = token) {
  const r = await fetch(base + '/api' + p, {
    method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: r.status, body: await r.json() };
}
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; }
}

const server = app.listen(0, async () => {
  base = 'http://127.0.0.1:' + server.address().port;
  console.log('Finance Guru API tests');

  await t('health check', async () => assert.equal((await call('GET', '/health')).body.ok, true));
  await t('rejects requests without a token', async () => assert.equal((await call('GET', '/state', null, null)).status, 401));
  await t('rejects a forged token', async () => assert.equal((await call('GET', '/state', null, 'abc.def')).status, 401));
  await t('register validates input', async () => {
    assert.equal((await call('POST', '/auth/register', { username: 'x', password: '1' })).status, 400);
  });
  await t('register creates account with default expenses', async () => {
    const r = await call('POST', '/auth/register', { username: 'asha', password: 'secret1', name: 'Asha', city: 'Mysuru', workerType: 'driver' });
    assert.equal(r.status, 201); token = r.body.token;
    assert.equal(r.body.state.name, 'Asha'); assert.equal(r.body.state.expenses.length, 3); assert.equal(r.body.state.totalExpenses, 8399);
  });
  await t('duplicate username is refused', async () => {
    assert.equal((await call('POST', '/auth/register', { username: 'ASHA', password: 'secret1', name: 'A' })).status, 409);
  });
  await t('wrong password is refused', async () => assert.equal((await call('POST', '/auth/login', { username: 'asha', password: 'nope00' })).status, 401));
  await t('login works', async () => {
    const r = await call('POST', '/auth/login', { username: 'asha', password: 'secret1' });
    assert.equal(r.status, 200); token = r.body.token;
  });
  let incomeId;
  await t('log income updates month income and safe-to-spend', async () => {
    const r = await call('POST', '/income', { amount: 22000, note: 'Week 1' });
    assert.equal(r.status, 201);
    const s = r.body.state; incomeId = s.incomeLog[0].id;
    assert.equal(s.monthIncome, 22000);
    assert.equal(s.summary.save, 3300);                 // 15% because > 20000
    assert.equal(s.summary.safe, 22000 - 8399 - 3300);
    assert.equal(s.activity[0].type, 'income');
  });
  await t('negative / zero amounts are rejected', async () => {
    assert.equal((await call('POST', '/income', { amount: -5 })).status, 400);
    assert.equal((await call('POST', '/income', { amount: 'abc' })).status, 400);
  });
  await t('delete income entry', async () => {
    const r = await call('DELETE', '/income/' + incomeId);
    assert.equal(r.body.state.monthIncome, 0); assert.equal(r.body.state.incomeLog.length, 0);
  });
  let expId;
  await t('add, toggle, edit and delete expense', async () => {
    let r = await call('POST', '/expenses', { name: 'Fuel', amount: 800, icon: '⛽' });
    expId = r.body.state.expenses.find(e => e.name === 'Fuel').id; assert.equal(r.body.state.totalExpenses, 9199);
    r = await call('PATCH', '/expenses/' + expId, { active: false }); assert.equal(r.body.state.totalExpenses, 8399);
    r = await call('PATCH', '/expenses/' + expId, { active: true, amount: 1000 }); assert.equal(r.body.state.totalExpenses, 9399);
    r = await call('DELETE', '/expenses/' + expId); assert.equal(r.body.state.totalExpenses, 8399);
  });
  await t('pay expense adds to activity', async () => {
    const r = await call('POST', '/expenses/pay', { amount: 5000, note: 'Rent' });
    assert.equal(r.body.state.activity[0].type, 'expense'); assert.equal(r.body.state.activity[0].note, 'Rent paid');
  });
  await t('buffer deposit and withdraw', async () => {
    let r = await call('POST', '/buffers/lean/deposit', { amount: 4000 }); assert.equal(r.body.state.leanBal, 4000);
    r = await call('POST', '/buffers/lean/withdraw', { amount: 1500, reason: 'Medical' }); assert.equal(r.body.state.leanBal, 2500);
    assert.equal(r.body.state.bufferTx[0].kind, 'wd');
  });
  await t('cannot withdraw more than balance', async () => {
    const r = await call('POST', '/buffers/emer/withdraw', { amount: 1, reason: 'x' }); assert.equal(r.status, 400);
  });
  await t('withdraw needs a reason', async () => {
    assert.equal((await call('POST', '/buffers/lean/withdraw', { amount: 10 })).status, 400);
  });
  await t('invalid fund name rejected', async () => {
    assert.equal((await call('POST', '/buffers/gold/deposit', { amount: 10 })).status, 400);
  });
  await t('settings update', async () => {
    const r = await call('PUT', '/settings', { name: 'Asha K', leanTarget: 40000 });
    assert.equal(r.body.state.name, 'Asha K'); assert.equal(r.body.state.leanTarget, 40000);
  });
  await t('users cannot touch each other\'s data', async () => {
    const other = (await call('POST', '/auth/register', { username: 'bob', password: 'secret1', name: 'Bob' })).body;
    const bobExp = other.state.expenses[0].id;
    assert.equal((await call('DELETE', '/expenses/' + bobExp)).status, 404);   // asha's token
  });
  await t('export returns full data', async () => {
    const r = await call('GET', '/export'); assert.ok(r.body.exportedAt); assert.equal(r.body.username, 'asha');
  });
  await t('reset clears money data but keeps account', async () => {
    const r = await call('POST', '/reset'); assert.equal(r.body.state.leanBal, 0); assert.equal(r.body.state.activity.length, 0);
    assert.equal(r.body.state.name, 'Asha K');
  });
  await t('demo login seeds Raju', async () => {
    const r = await call('POST', '/auth/demo', null, null);
    const s = r.body.state;
    assert.equal(s.name, 'Raju'); assert.equal(s.monthIncome, 23400); assert.equal(s.totalExpenses, 12099);
    assert.equal(s.history.length, 24); assert.equal(s.leanBal, 12400); assert.equal(s.emerBal, 8200);
  });
  await t('month rollover archives last month', async () => {
    const { db } = require('./db');
    const r0 = await call('POST', '/auth/register', { username: 'mona', password: 'secret1', name: 'Mona' }); const tk = r0.body.token;
    await call('POST', '/income', { amount: 9000 }, tk);
    db.prepare("UPDATE users SET month_key='2020-01' WHERE username='mona'").run();
    const r = await call('GET', '/state', null, tk);
    assert.equal(r.body.wrapUp.income, 9000); assert.equal(r.body.state.monthIncome, 0);
    assert.equal(r.body.state.history.at(-1).month, 'Jan'); assert.equal(r.body.state.history.at(-1).income, 9000);
  });

  /* ---- SMS import ---- */
  const { parseSms } = require('./sms');
  await t('SMS parser: credit, debit, OTP, promo, personal', async () => {
    const c = parseSms('Rs.1,150.00 credited to A/c XX2153 on 20-11-26 by SWIGGY (UPI Ref No 412345678)', 'AX-HDFCBK', '2026-11-21');
    assert.equal(c.status, 'ok'); assert.equal(c.type, 'income'); assert.equal(c.amount, 1150); assert.equal(c.category, 'Gig earnings'); assert.equal(c.date, '2026-11-20');
    const d = parseSms('INR 500 debited from A/c XX2153 on 19-Nov-26 to HP PETROL', 'AX-SBIINB', '2026-11-21');
    assert.equal(d.type, 'expense'); assert.equal(d.amount, 500); assert.equal(d.category, 'Fuel'); assert.equal(d.date, '2026-11-19');
    assert.equal(parseSms('482913 is your OTP for txn of Rs 999 at AMAZON on card XX1').status, 'ignored');
    assert.equal(parseSms('Get cashback upto Rs 500 on recharge! Apply now').status, 'ignored');
    assert.equal(parseSms('Bro send 200 for lunch').status, 'ignored');
  });
  let dtk;
  await t('SMS import adds income, logs spends, and is not double-counted', async () => {
    dtk = (await call('POST', '/auth/demo', null, null)).body.token;
    const msgs = (await call('GET', '/sms/sample', null, dtk)).body.messages;
    const pv = await call('POST', '/sms/preview', { messages: msgs }, dtk);
    assert.equal(pv.body.items.filter(x => x.status === 'ok').length, 7);
    const r = await call('POST', '/sms/import', { messages: msgs }, dtk);
    assert.equal(r.body.result.added, 7); assert.equal(r.body.result.income, 9901); assert.equal(r.body.state.monthIncome, 23400 + 9901);
    const again = await call('POST', '/sms/import', { messages: msgs }, dtk);
    assert.equal(again.body.result.added, 0); assert.equal(again.body.result.duplicates, 7); assert.equal(again.body.state.monthIncome, 33301);
    const pv2 = await call('POST', '/sms/preview', { messages: msgs }, dtk);
    assert.equal(pv2.body.items.filter(x => x.status === 'duplicate').length, 7);
  });
  await t('SMS import validates input', async () => {
    assert.equal((await call('POST', '/sms/import', { messages: 'x' }, dtk)).status, 400);
    assert.equal((await call('POST', '/sms/import', { messages: [] }, dtk)).status, 400);
  });

  /* ---- Predictor & alerts ---- */
  await t('model was trained on the rider dataset with a backtest', async () => {
    const m = JSON.parse(fs.readFileSync(path.join(__dirname, 'dataset', 'model.json'), 'utf8'));
    assert.equal(m.riders, 600); assert.equal(m.cityNames.length, 6); assert.ok(m.backtest.predictions > 5000);
    assert.ok(m.backtest.seasonalLeanRecall > 80); assert.ok(m.backtest.mape < m.backtest.naiveMape, 'beats "same as last month"');
    for (const c of Object.values(m.cities)) assert.equal(c.index.length, 12);
  });
  await t('Raju: predictor learns his Aug–Sep lean season and plans savings', async () => {
    const I = (await call('POST', '/auth/demo', null, null)).body.state.insights;
    assert.equal(I.city, 'Bengaluru'); assert.equal(I.personal, true); assert.equal(I.outlook.length, 12);
    const aug = I.outlook.find(f => f.key.endsWith('-08')), oct = I.outlook.find(f => f.key.endsWith('-10'));
    assert.ok(aug.pLean > 0.4 && oct.pLean < 0.2, `aug ${aug.pLean} oct ${oct.pLean}`);
    assert.ok(I.outlook.every(f => f.low <= f.amount && f.amount <= f.high));
    assert.ok(I.seasonPlan && I.seasonPlan.perMonth > 0);
    assert.ok(I.alerts.some(a => a.id === 'season')); assert.equal(I.surplus, null);
  });
  await t('good month triggers the surplus plan; slow month triggers pace alert', async () => {
    const r = await call('POST', '/income', { amount: 12000 }, (await call('POST', '/auth/demo', null, null)).body.token);
    const I = r.body.state.insights; assert.ok(I.surplus); assert.equal(I.alerts[0].id, 'good');
    assert.equal(I.surplus.steps.reduce((a, s) => a + s.amount, 0), I.surplus.amount);
    const tk2 = (await call('POST', '/auth/login', { username: 'raju', password: 'raju123' }, null)).body.token;
    for (const st of I.surplus.steps.filter(x => x.id === 'emer' || x.id === 'lean')) await call('POST', `/buffers/${st.id}/deposit`, { amount: st.amount, note: 'Surplus plan' }, tk2);
    const after = (await call('GET', '/state', null, tk2)).body.state.insights;
    assert.ok(!after.surplus || after.surplus.amount < I.surplus.amount, 'surplus shrinks once moved');
    const { buildInsights } = require('./predictor');
    const slow = buildInsights({ city: 'Mumbai', monthKey: '2026-07', monthIncome: 3000, totalExpenses: 10000, spent: 0, history: [],
      leanBal: 0, emerBal: 0, leanTarget: 30000, emerTarget: 15000, today: new Date(2026, 6, 15) });
    for (const id of ['pace', 'bills', 'runway', 'emer']) assert.ok(slow.alerts.some(a => a.id === id), id);
  });

  await t('Android app download is served', async () => {
    const r = await fetch(base + '/download/FinanceGuru.apk');
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'application/vnd.android.package-archive');
    assert.ok((await r.arrayBuffer()).byteLength > 1e6);
  });

  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ', all good'}`);
  server.close(); fs.rmSync(tmp, { recursive: true, force: true });
});
