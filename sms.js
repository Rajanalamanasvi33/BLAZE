// sms.js — turns Indian bank / UPI SMS text into transactions (no AI, transparent rules).
const crypto = require('crypto');

const CATEGORY_RULES = [
  [/swiggy|zomato|zepto|blinkit|instamart|dunzo|uber|ola\b|rapido|porter|urban ?company|bundl/i, 'Gig earnings', 'income', 'receive'],
  [/petrol|hpcl|iocl|bpcl|indian ?oil|fuel|shell/i, 'Fuel', 'expense', 'fuel'],
  [/jio|airtel|vodafone|\bvi\b|bsnl|recharge/i, 'Phone', 'expense', 'phone'],
  [/bescom|electricity|power|tneb|msedcl|tata ?power|bses/i, 'Electricity', 'expense', 'bulb'],
  [/rent|landlord/i, 'Rent', 'expense', 'home'],
  [/emi|loan|bajaj|finance/i, 'EMI', 'expense', 'doc'],
  [/dmart|bigbasket|grocer|kirana|more ?retail|reliance ?fresh/i, 'Groceries', 'expense', 'cart'],
  [/hospital|pharma|medical|apollo|clinic/i, 'Medical', 'expense', 'pill']
];
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = n => String(n).padStart(2, '0');

function parseDate(t, today) {
  let m = t.match(/\b(\d{1,2})[-/ ]?([A-Za-z]{3})[-/ ]?(\d{2,4})\b/);           // 21-Nov-26, 21Nov2026
  if (m && MON[m[2].toLowerCase()]) return iso(+m[1], MON[m[2].toLowerCase()], +m[3]);
  m = t.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);                     // 21-11-26, 21/11/2026
  if (m) return iso(+m[1], +m[2], +m[3]);
  return today;
  function iso(d, mo, y) { if (y < 100) y += 2000; if (mo < 1 || mo > 12 || d < 1 || d > 31) return today; return `${y}-${pad(mo)}-${pad(d)}`; }
}

/**
 * Parse one SMS. Returns { status:'ok', amount, type, merchant, category, icon, date, ref }
 * or { status:'ignored', reason }.
 */
function parseSms(text, sender = '', today = new Date().toISOString().slice(0, 10)) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return { status: 'ignored', reason: 'Empty' };
  if (/\botp\b|one[- ]time password|verification code|do not share/i.test(t)) return { status: 'ignored', reason: 'OTP — never stored' };
  if (/cashback up ?to|offer|win |congratulations|pre-approved|apply now|t&c/i.test(t)) return { status: 'ignored', reason: 'Promotional' };
  if (!/a\/c|acct|account|upi|vpa|neft|imps|card|bank/i.test(t)) return { status: 'ignored', reason: 'Not a bank message' };
  const am = t.match(/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!am) return { status: 'ignored', reason: 'No amount found' };
  const amount = Math.round(parseFloat(am[1].replace(/,/g, '')));
  if (!(amount > 0)) return { status: 'ignored', reason: 'No amount found' };
  const credit = /credited|received|deposited|\bcr\b/i.test(t), debit = /debited|spent|paid|withdrawn|sent|\bdr\b|purchase/i.test(t);
  if (credit === debit) return { status: 'ignored', reason: 'Not a credit or debit' };
  const type = credit ? 'income' : 'expense';

  // Counter-party: VPA, or the words after by/from/to/at
  let merchant = '';
  const vpa = t.match(/(?:vpa|to|from)\s+([a-z0-9._-]+)@[a-z]+/i);
  const who = t.match(/(?:\bby\b|\bfrom\b|\bto\b|\bat\b|trf to|info:?)\s+(?!a\/c|your|acct|account|vpa)([A-Za-z][A-Za-z0-9&.' -]{2,30}?)(?=\s*(?:\(|\.|,|on\b|ref|upi|via|avl|-|$))/i);
  if (who) merchant = who[1]; else if (vpa) merchant = vpa[1].replace(/[._-]/g, ' ');
  merchant = merchant.replace(/\s+(bundl|ltd|limited|pvt|private|technologies|tech)\b.*$/i, '').trim().slice(0, 30) || (credit ? 'UPI credit' : 'UPI payment');

  const rule = CATEGORY_RULES.find(([re]) => re.test(merchant) || re.test(t));
  let category, icon;
  if (rule && (rule[2] === type)) { category = rule[1]; icon = rule[3]; }
  else { category = credit ? 'Other income' : 'Other spending'; icon = credit ? 'receive' : 'send'; }

  const refM = t.match(/(?:ref(?:erence)?\.?\s*(?:no\.?)?|utr|txn(?: id)?)[:\s#]*([A-Z0-9]{6,22})/i);
  const ref = refM ? refM[1] : crypto.createHash('sha256').update(sender + '|' + t).digest('hex').slice(0, 20);
  return { status: 'ok', amount, type, merchant: titleCase(merchant), category, icon, date: parseDate(t, today), ref };
}
const titleCase = s => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

/** Realistic demo inbox dated in the current month (what an Android phone would hand us). */
function sampleInbox(now = new Date()) {
  const day = Math.max(1, now.getDate());
  const d = k => { const x = Math.max(1, day - k); return `${pad(x)}-${pad(now.getMonth() + 1)}-${String(now.getFullYear()).slice(2)}`; };
  const ym = `${now.getFullYear()}${pad(now.getMonth() + 1)}`;
  return [
    { sender: 'AX-HDFCBK', text: `Rs.2,340.00 credited to A/c XX2153 on ${d(0)} by SWIGGY BUNDL TECHNOLOGIES (UPI Ref No 4${ym}0141). Avl Bal Rs.6,812.40 -HDFC Bank` },
    { sender: '+91 98450 22xxx', text: 'Bro coming for lunch today? Meet near Silk Board' },
    { sender: 'VM-HDFCBK', text: `482913 is your OTP for txn of Rs 999.00 at AMAZON on HDFC Bank card XX4421. Do not share OTP with anyone.` },
    { sender: 'JD-SBIINB', text: `Dear Customer, INR 3,120.50 credited to your A/c XX7781 on ${d(1)} via NEFT from ZOMATO LIMITED. Ref ${ym}N2207. -SBI` },
    { sender: 'AX-HDFCBK', text: `Rs 450.00 debited from A/c XX2153 on ${d(1)} to HPCL PETROL PUMP (UPI Ref No 4${ym}0367). Not you? Call 18002586161 -HDFC Bank` },
    { sender: 'VK-PROMOS', text: 'Congratulations! Get cashback upto Rs 500 on your next recharge. Apply now T&C apply' },
    { sender: 'AD-KOTAKB', text: `Rs.1,890.00 credited to Kotak A/c XX9902 on ${d(2)} by ZEPTO (UPI Ref 4${ym}0593).` },
    { sender: 'AX-HDFCBK', text: `Rs 399.00 debited from A/c XX2153 on ${d(2)} to RELIANCE JIO (UPI Ref No 4${ym}0611) -HDFC Bank` },
    { sender: 'AX-HDFCBK', text: `Received Rs.50.00 in your A/c XX2153 on ${d(3)} from ramesh.k@okicici (UPI Ref No 4${ym}0702) -HDFC Bank` },
    { sender: 'AX-HDFCBK', text: `Rs.2,500.00 credited to A/c XX2153 on ${d(3)} by SWIGGY weekly incentive (UPI Ref No 4${ym}0815) -HDFC Bank` }
  ];
}

module.exports = { parseSms, sampleInbox };
