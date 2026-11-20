# Indian Delivery Rider Income Dataset

Regenerate everything (same seed → identical files): `node dataset/generate.js`

| File | Rows | What it is |
|---|---|---|
| `riders.csv` | 600 | One rider each: city, platform, vehicle, full/part-time, hours per day, hometown months |
| `riders_monthly.csv` | ~20,000 | Net earnings, orders, active days, lean flag and shock reason for every rider-month, Dec 2023 to Nov 2026 |
| `model.json` | — | The trained predictor: seasonal index per city, typical income, uncertainty and backtest results |

## Be honest about what this is
No public dataset gives month-by-month income for individual Indian gig workers. This is a **simulated dataset**. Every effect in it is modelled on a published, checkable pattern. Once users link their bank, their real SMS or Account Aggregator data replaces it, and the same code retrains on that data.

## Assumptions and where they come from

| Effect | How it's modelled | Basis |
|---|---|---|
| Cities | Bengaluru 24%, Delhi NCR 20%, Mumbai 18%, Hyderabad 14%, Chennai 12%, Pune 12% | Biggest food and quick-commerce markets |
| Income level | Full-time net about ₹19.5k–23k/month by city, part-time about half, rider skill varies ±15% | Commonly reported delivery-partner net earnings (NITI Aayog *India's Booming Gig and Platform Economy* 2022, Fairwork India reports, news surveys) |
| Monsoon | Heavy rain cuts income by up to 35% (lost hours, flooding). Light rain adds about 3% (surge pay) | **IMD normal monthly rainfall** per city. Each year's monsoon is randomly ±35% stronger or weaker |
| Heatwave | Apr–May: −9% Delhi, −6% Hyderabad | IMD heatwave seasons |
| Festivals | Diwali month +16%, month before +5%, December +5% | Real Diwali dates: 12 Nov 2023, 1 Nov 2024, 20 Oct 2025, 8 Nov 2026 |
| IPL | Apr–May +3% (evening orders) | IPL season |
| Migrant hometown trips | 30% of riders lose 40–65% of income in fixed months (sowing Jun–Jul, harvest Apr, Chhath/Diwali Nov, or Aug–Sep) in 85% of years | Seasonal return migration of inter-state workers |
| Shocks | Each month: illness 3.5%, bike repair 3%, ID blocked 1.5%, family event 1% | Common gig-worker income shocks |
| Noise and trend | ±8% monthly noise, +3% ± 5% yearly earnings trend per rider | — |

## How the predictor works (`predictor.js`)
1. **City pattern:** for every rider-year, divide each month by that year's average. The median per calendar month is the city's **seasonal index**.
2. **Personal pattern:** once a user has 12 or more months of history, their own month ratios are blended in. One year gets 50% weight and two years 67%, which damps one-off shocks.
3. **Baseline:** the median of the last 6 de-seasonalised months. A new user starts from the city's typical rider income.
4. **Forecast:** baseline × index. **Range and lean probability** use the log-normal error measured during training (σ ≈ 0.27).

## Backtest (in `model.json`)
Trained on Dec 2023 to Nov 2025, then predicts each month from Dec 2025 to Nov 2026, one month ahead (7,200 predictions):
- Typical (median) error is **about 10%**. Mean error is 18.3%, against 24.1% for "same as last month".
- **About 90% of seasonal lean months are flagged** at the app's 30% alert threshold.
- Personalisation raises the share of all lean months caught from 48% to 62%.
- Random shocks such as illness can't be predicted. That's what the Emergency Fund is for.
