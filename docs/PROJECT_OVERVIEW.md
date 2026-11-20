# Finance Guru — Complete Project Overview

> Full project brief for Finance Guru (Tech Habba 2026, team of 4).

**Live app:** https://finance-guru-me2j.onrender.com
**Code:** private GitHub repo `Karthikgoud14/finance-guru`
**Demo account:** tap "Load Demo (Raju)" on the start screen. The demo login is username `raju`, password `raju123`.

---

## 1. The problem

India has millions of gig and informal workers: delivery riders, cab drivers, construction labourers, domestic workers and street vendors. Their **income changes a lot from month to month**. A delivery rider might earn ₹27,800 in a busy month and only ₹9,200 in a slow one.

Normal budgeting apps assume a fixed monthly salary, so they don't fit these workers. Without planning, a worker's lean months lead to borrowing, then high-interest loans, then a debt trap. Our example user, Raju, has ₹12,099 of fixed monthly costs (rent, groceries, phone, fuel, EMI, electricity). In a lean month that earns ₹9,200, he can't even cover them.

## 2. The solution

**Finance Guru** is a mobile-first budgeting web app designed for **variable income**. It tells the worker three things:

1. **How much is safe to spend this month**, after fixed expenses and savings.
2. **How much to save**, with a savings rate that adjusts to how much they earned.
3. **How to survive lean months**, using two savings "buffers":
   - **Lean Month Fund** (target ₹30,000): used when monthly income falls below ₹15,000.
   - **Emergency Fund** (target ₹15,000): only for unexpected costs like medical bills or repairs, never for regular expenses.

**Tagline:** "Steady money for unsteady income."

## 3. Core logic (the "brain")

### Safe-to-spend formula
```
savings rate = 15%  if monthly income > ₹20,000
             = 10%  if monthly income > ₹15,000
             =  0%  otherwise (a lean month, so we don't squeeze the worker)

savings       = income × savings rate
safe to spend = income − active fixed expenses − savings   (never below 0)
```
**Example (Raju, November):** income ₹23,400, savings at 15% = ₹3,510, fixed expenses ₹12,099. Safe to spend = **₹7,791**.

### Lean month rule
A month is **lean** if its income is below **₹15,000**. Lean months are highlighted in red on the charts. That's when the worker should draw from the Lean Month Fund.

### New-month rollover
When a new calendar month starts, the server automatically:
- Archives last month (income, savings made, money deposited into each fund) into the 12-month history.
- Resets this month's income to ₹0 and clears the income log.
- **Keeps the buffer balances.**
- Shows the user a "Month Wrap-Up" summary: income earned, savings made, expenses paid.

## 4. Screens and features

The app has 4 tabs in a floating bottom navigation bar, plus pop-up "bottom sheets" for actions.

### Start screen
- Animated app logo (a red rounded square with ₹).
- **Sign up** (username, password, name, city, type of work: Delivery, Driver, Construction, Domestic, Vendor or Other) or **Log in**.
- **Load Demo (Raju):** one tap fills the app with a full year of realistic data.

### Tab 1: Home
- **Header:** profile icon, "Namaste, [name]", and a settings button.
- **Hero number:** "Safe to spend this month" as a big number that counts up when it changes, with chips showing Income and Saving (with the %). Shows a warning if expenses are more than income.
- **Quick actions panel:** Log Income (the main action, a glowing red button), Pay Expense, Save, Withdraw.
- **Two fund cards:** Lean Fund (red) and Emergency (amber), each with balance, progress bar and amount left to reach the goal.
- **This-month summary:** month, amount spent on expenses, total income logged.
- **Recent Activity:** the last 5 transactions. Money in is green with "+", money out is white with "−".

### Tab 2: Budget
- **Income flow card:** Monthly Income, then Savings (%), then Fixed Expenses, then Safe to Spend, each with a coloured left bar.
- **Income This Month:** the daily income log with a delete button on each entry, an "Add Entry" button, and the total.
- **Fixed Expenses:** a list with on/off toggles (switched-off expenses aren't counted). Edit mode lets you change amounts or delete expenses. "Add Expense" lets you set a name, amount and icon. Shows the total of active expenses.

### Tab 3: Buffers
- **Lean Month Fund card:** large balance, progress toward the ₹30,000 target, Deposit and Withdraw buttons, last 5 transactions.
- **Emergency Fund card:** the same, with a ₹15,000 target.
- **Info card:** "When to use each buffer."

### Tab 4: Trends (3 views)
- **Chart:** a hand-drawn 12-month income bar chart.
  - Lean months are red, the current month is white, normal months are grey.
  - A dashed line marks the ₹15K lean limit.
  - Tap a bar to see the exact amount.
- **Months:** a grid of month cards showing income and savings, with LEAN and NOW badges.
- **Compare:** a "Without Finance Guru vs With Finance Guru" table:

| Metric | Without FG | With FG |
|---|---|---|
| Lean month income | ₹10,200 | ₹30,400 effective |
| Months in debt per year | 3–4 | 0 |
| Annual savings | under ₹1,000 | ₹25,000+ |
| Emergency buffer | ₹0 | ₹8,200+ |
| Financial stress | Extreme | Managed |

### Pop-up sheets (slide up from the bottom)
- **Log Income:** amount (large number keypad), optional note, today's date.
- **Pay Expense:** tap one of your fixed expenses to fill it in, or type a custom amount, then "Mark as Paid".
- **Save to Buffer:** pre-filled with the recommended 15% of income; choose Lean Fund or Emergency Fund.
- **Draw from Buffer:** choose the fund, see its balance, enter an amount and a **required reason**. It warns you and blocks the withdrawal if the amount is more than the balance.
- **Add Expense:** name, amount, choice of 10 icons.
- **Settings:** edit name, city, type of work and both fund targets; Export Data (copies all your data as JSON); Reset App (with a confirmation); Log Out. Version: v2.0 | Finance Guru | Tech Habba 2026.
- **Month Wrap-Up:** last month's summary (described above).

### New: Smart features
- **Import from SMS** (Home): reads bank and UPI SMS such as "Rs.2,340 credited … by SWIGGY". Each message is sorted automatically (Gig earnings, Fuel, Phone, Rent…), OTPs, promotional and personal messages are skipped, and nothing is counted twice. The web demo uses a realistic sample inbox plus a "paste any SMS" box. The Android app would read the inbox with permission.
- **Lean Month Predictor** (Trends): a 3-month forecast drawn as dashed bars with an 80% range, the chance of a lean month, the next lean season and how much to save each month to cover it. It learns the worker's own pattern (for Raju: Aug–Sep) on top of the city pattern.
- **Early Warning Alerts** (Home): slow month so far, next month lean, lean season ahead, bills not covered, buffers running out, Emergency Fund thin, and "Great month!"
- **Surplus plan** (Home): in a good month the extra goes, in order, to the Emergency Fund (up to 3 months of costs), then the Lean Fund, then goal savings, with 20% kept for guilt-free spending. One tap moves it to the buffers. It carries a SEBI caution.
- **Dataset** (`dataset/`): 600 simulated Indian delivery riders in 6 cities over 36 months, built on IMD rainfall normals, real Diwali dates, heatwaves, IPL, migrant hometown trips and income shocks. Backtest: about 10% typical error, and about 90% of seasonal lean months caught.

## 5. Design and look

- **Inspired by modern fintech apps:** near-black background with a deep **crimson/red glow** at the top, and **frosted-glass** translucent cards with soft borders and large rounded corners (22–28px).
- **Colours:**
  - Accent red `#F0364F`, with a red gradient on main buttons.
  - Positive/income green `#3DDC84`.
  - Emergency amber `#F2B544`.
  - Text white, muted text `#8F8A8D`.
- **Icons:** about 30 custom thin line icons drawn as inline SVG. **No emoji** anywhere.
- **Font:** the system font (SF Pro on iPhone, Roboto on Android).
- **Bottom navigation:** a floating, blurred pill. The active tab is highlighted with a red icon.
- **Animations:**
  - The logo pulses.
  - Tabs slide when you switch.
  - Sheets slide up and can be dragged down to close.
  - Numbers count up when they change.
  - Progress bars fill smoothly.
  - Buttons shrink slightly when tapped.
- **Phone-friendly:** max width 430px, touch targets at least 44px, supports the iPhone notch area. Works on iPhone Safari and Android Chrome.

## 6. Technology

### Frontend
- **One file, `index.html`:** HTML, CSS and plain JavaScript. No framework and no libraries.
- **Canvas API** for the chart, which stays sharp on high-resolution screens and redraws when the window resizes.
- **`fetch()`** calls the REST API. After any change, the server sends back the user's full updated data, and the screen redraws from it.
- **localStorage** stores the login token and a cached copy of the data, so the app opens instantly.

### Backend
- **Node.js and Express** (`server.js`): REST API.
- **SQLite** using Node's built-in `node:sqlite` module, so no separate database to install (`db.js`). **6 tables:**
  - `users`: profile, buffer balances, targets, this month's income, current month.
  - `income`: daily income entries.
  - `expenses`: fixed expenses with an on/off flag.
  - `activity`: everything that happened (income, expense, buffer save, buffer withdrawal).
  - `buffer_tx`: deposits and withdrawals for each fund.
  - `history`: monthly archive (income, saved, money deposited into each fund).
- **Security:**
  - Passwords are hashed with **scrypt** and a per-user salt.
  - **HMAC-SHA256 signed tokens** that expire after 30 days.
  - Login and sign-up are rate-limited.
  - Every input is checked on the server.
  - Money changes run in database transactions.
  - A withdrawal can't take more than the fund's balance, even if two requests arrive at once.
  - Every query is limited to the logged-in user's own data.
  - Security headers are set on every response.
- **Testing:** 29 automated end-to-end API tests (`npm test`).

### API routes
All routes except the sign-in ones need the header `Authorization: Bearer <token>`.

| Method | Route | Purpose |
|---|---|---|
| POST | /api/auth/register | Create an account |
| POST | /api/auth/login | Log in |
| POST | /api/auth/demo | Create or reset the Raju demo |
| GET | /api/state | All of the user's data (also does the month rollover) |
| GET | /api/summary | Safe-to-spend numbers |
| POST / DELETE | /api/income, /api/income/:id | Log or delete income |
| POST / PATCH / DELETE | /api/expenses, /api/expenses/:id | Add, edit or toggle, delete an expense |
| POST | /api/expenses/pay | Mark an expense as paid |
| POST | /api/buffers/:fund/deposit | Deposit into `lean` or `emer` |
| POST | /api/buffers/:fund/withdraw | Withdraw (a reason is required; can't exceed the balance) |
| PUT | /api/settings | Update profile and targets |
| GET | /api/export | Export all data |
| POST | /api/reset | Wipe money data, keep the account |
| DELETE | /api/account | Delete the account |

### Hosting
- Code on **GitHub**. Deployed on **Render** (free plan) using a `render.yaml` setup file. Every push to `main` redeploys automatically.
- **Free-plan limits:**
  - The server sleeps after about 15 minutes with no visitors, so the first visit afterwards takes about 50 seconds.
  - The database resets when the server restarts, but the Raju demo always works because it recreates its data.
  - Fix for production: Render's Starter plan with a persistent disk, or a hosted database such as PostgreSQL or Turso.

## 7. Demo data (Raju)

- **Profile:** Raju, Bengaluru, delivery worker.
- **Fixed expenses:** Rent ₹5,500, Groceries ₹3,000, Phone ₹399, Fuel ₹800, EMI ₹1,800, Electricity ₹600 (total ₹12,099).
- **This month's income:** ₹23,400.
- **Funds:** Lean Fund ₹12,400 of ₹30,000; Emergency Fund ₹8,200 of ₹15,000.
- **12-month income:** Dec ₹10,200 (lean), Jan ₹22,400, Feb ₹24,800, Mar ₹26,200, Apr ₹23,100, May ₹21,800, Jun ₹24,500, Jul ₹27,800, Aug ₹9,200 (lean), Sep ₹11,500 (lean), Oct ₹23,400, Nov ₹23,400 (current).

## 8. Team roles for the pitch

- **Speaker 1:** visuals and features.
- **Speaker 2:** backend and security.
- **Speaker 3:** the problem, research and impact.
- **Speaker 4:** the core logic, the live demo and the roadmap.

## 9. Future roadmap

- Hindi and Kannada, plus voice input for low-literacy users.
- Import earnings automatically from UPI or SMS.
- AI forecasting of lean months from past patterns, with early warnings.
- SMS or WhatsApp reminders to save after a good week.
- Partnerships with gig platforms (Swiggy, Zomato, Uber) and micro-insurance or savings providers.
- **Scaling:** PostgreSQL, a paid server and an installable app (PWA) that works offline. The API doesn't keep anything in memory between requests, so more servers can be added easily.

## 10. Business model (proposed)

- **Free for workers.**
- **Revenue:**
  - B2B partnerships with gig platforms, who benefit from more financially stable workers.
  - Referral fees from micro-savings, insurance and credit partners.
  - Anonymised, aggregated income-trend insights, with the users' consent.
