# Tourly

Mobile app for professional tennis players (ITF World Tennis Tour circuit) to manage their tournament schedule, deadlines, and travel expenses.

## Features

- **Tournament tracker** — add tournaments manually or from search; auto-calculates ITF deadlines (singles entry −18d, withdrawal −13d, freeze/doubles −4d)
- **Alerts** — grouped by tournament, color-coded by urgency (red / amber / green)
- **Calendar** — monthly view with sticky headers and surface-color-coded tournament banners
- **Expenses** — per-tournament expense tracking with week / month / year period filter, prize money, and net calculation
- **Home dashboard** — active tournament summary, upcoming deadlines with urgency colors

## Tech Stack

- [Expo](https://expo.dev) 54 (React Native)
- [InstantDB](https://instantdb.com) — real-time database
- [Expo Router](https://expo.github.io/router/) v6 — file-based navigation
- TypeScript

## Getting Started

```bash
npm install

# Run locally
npx expo start

# Run on phone via tunnel (when not on same LAN)
npx expo start --tunnel
```

On Windows, Node may not be in PATH:
```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
npx expo start --tunnel
```

## Project Structure

```
app/(tabs)/       # Five main screens (home, tournaments, expenses, alerts, calendar)
components/ui/    # Reusable primitives (CourtIcon, DatePickerField, etc.)
hooks/            # useAppQuery, useDemoData (AsyncStorage-backed demo state)
utils/            # deadlines.ts, notifications.ts
config/demo.ts    # Demo mode toggle + seed data
db.ts             # InstantDB client
```

## Demo Mode

Set `DEMO_MODE = true` in `config/demo.ts` to bypass auth and use local seed data. All mutations persist via AsyncStorage so data survives app restarts.
