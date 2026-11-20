# Finance Guru

**Steady money for unsteady income.**

**Track:** Finance (F1) — The Irregular Income Problem

**Live app:** https://finance-guru-me2j.onrender.com
**Android app:** [Download APK](https://finance-guru-me2j.onrender.com/download/FinanceGuru.apk)
**Demo login:** tap **Load Demo (Raju)**, or use `raju` / `raju123`

---

## The problem
People with irregular income, such as gig workers, delivery riders, freelancers and vendors, run out of money in lean months even when their yearly income would cover their needs. Budgeting tools assume a fixed monthly salary, so this group ends up borrowing at high interest or selling assets during slow months.

## Our solution
Finance Guru is a mobile-first finance app built for irregular income. It uses **income smoothing**: in good months it suggests saving into two buffers.
- A **Lean Month Fund** covers seasonal drops.
- An **Emergency Fund** covers unexpected costs like medical bills or repairs.

When a lean month hits, the buffer takes over and the app shows a safe spending limit. No borrowing and no interest.

A delivery rider who saves 15% in good months can fully cover 2 lean months, which keeps ₹16,000+ a year out of the hands of moneylenders.

## Features
| Feature | What it does |
|---|---|
| **Safe to spend** | Income − fixed expenses − savings. The savings rate adjusts automatically: 15% above ₹20k, 10% above ₹15k, 0% in a lean month |
| **Two buffers** | Lean Month Fund and Emergency Fund, each with a target, progress, deposits and withdrawals (a reason is required, overdrawing is blocked) |
| **Automatic SMS import** | The Android app reads bank and UPI SMS ("Rs.2,340 credited … by SWIGGY") and logs income and spending automatically, live as messages arrive |
| **Lean Month Predictor** | A 12-month forecast with a likely range and the chance of a lean month. It learns the city's pattern and the worker's own pattern |
| **Early Warning Alerts** | Slow month so far, lean month ahead, lean season savings plan, bills not covered, how long buffers last, Emergency Fund too small |
| **Surplus plan** | In a good month the extra goes, in order, to the Emergency Fund, then the Lean Fund, then goal savings, with 20% kept for guilt-free spending. One tap moves it |
| **Trends** | A 12-month income chart with lean months highlighted, the forecast, month cards and a with/without comparison |
| **Month rollover** | Each new month, last month is archived automatically and a wrap-up summary is shown |

## Privacy and security
- **SMS stays on the phone** unless it's a bank transaction. Personal chats and OTPs are filtered out on the phone itself, and the server stores only a hash of each SMS, to avoid counting it twice.
- **Passwords** are hashed with scrypt. Login tokens are signed with HMAC-SHA256 and expire after 30 days.
- **Requests:** login is rate-limited and every input is checked on the server.
- **Money operations:** they run in database transactions, and the overdraw check is atomic.
- **Data separation:** every query is limited to the logged-in user's own data.
- **Investment advice:** the app gives general guidance only, not investment advice (in line with SEBI rules).

## Tech stack
| Part | Technology |
|---|---|
| Frontend | One `index.html`: HTML, CSS and plain JavaScript, a Canvas chart, SVG icons |
| Backend | Node.js + Express REST API |
| Database | SQLite (Node's built-in `node:sqlite`) |
| Android | Capacitor shell plus a native Java SMS reader plugin |
| Prediction | Seasonal model trained on a rider dataset, with a backtest |
| Hosting | Render (auto-deploys from GitHub) |

## Dataset and model accuracy
`dataset/` contains **600 simulated Indian delivery riders** in Bengaluru, Mumbai, Delhi, Hyderabad, Chennai and Pune, with 36 months each. The data is shaped by real patterns:
- each city's normal monthly rainfall from IMD;
- real Diwali dates and other festivals;
- heatwaves and the IPL season;
- migrant workers going home for sowing, harvest or festivals;
- income shocks like illness or bike repair.

**Backtest:** trained on the first 2 years, then each month of the 3rd year predicted one month ahead (7,200 predictions).

| Measure | Result |
|---|---|
| Seasonal lean months caught | **90.4%** |
| Typical forecast error | **9.9%** |
| Mean error vs "same as last month" | 18.3% vs 24.1% |

See [dataset/README.md](dataset/README.md) for every assumption and its source.

## Project structure
```
index.html        Frontend (all screens, sheets and the chart)
server.js         Express API, business rules, month rollover
db.js             SQLite schema
predictor.js      Lean Month Predictor, alerts, surplus plan
sms.js            Bank / UPI SMS parser
test.js           End-to-end API tests
dataset/          Rider dataset, generator, trained model
mobile/           Android app (Capacitor + native SMS plugin)
downloads/        Built Android APK served by the website
render.yaml       Render deployment config
```

## Run locally
Needs **Node.js 22.13+**.
```bash
npm install
npm start          # http://localhost:3000
npm test           # 30 API tests
```
Regenerate the dataset and model: `node dataset/generate.js`

## Android app
```bash
cd mobile
npm install
npx cap sync android
npx cap open android      # then Run ▶ in Android Studio
```
To test SMS on the emulator: open **Extended controls (⋯) → Phone**, type any sender number, paste a bank-style SMS and click **Send Message**. Or use the terminal:
```bash
adb emu sms send 5676766 "Rs.1,250.00 credited to A/c XX2153 on 21-11-26 by SWIGGY (UPI Ref No 455500111222) -HDFC Bank"
```
More details are in [mobile/README.md](mobile/README.md).

## API
All routes except `/api/auth/*` and `/api/health` need `Authorization: Bearer <token>`.

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/demo` | Sign up, log in, load the demo |
| GET | `/api/state` | All user data (also runs the month rollover) |
| GET | `/api/insights` | Forecast, alerts, surplus plan |
| POST / DELETE | `/api/income`, `/api/income/:id` | Log or remove income |
| POST / PATCH / DELETE | `/api/expenses`, `/api/expenses/:id` | Manage fixed expenses |
| POST | `/api/expenses/pay` | Mark an expense as paid |
| POST | `/api/buffers/:fund/deposit`, `/withdraw` | Lean or Emergency Fund |
| POST | `/api/sms/preview`, `/api/sms/import` | Parse and import bank SMS |
| PUT | `/api/settings` | Profile and targets |
| GET / POST / DELETE | `/api/export`, `/api/reset`, `/api/account` | Export, reset, delete the account |

## Roadmap
- Account Aggregator (RBI framework) bank linking
- Hindi and Kannada, with voice input
- WhatsApp alerts
- Gig platform partnerships
- A machine-learning model trained on real users' data
