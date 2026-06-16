# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
# Install dependencies (Node must be in PATH)
npm install

# Run on phone via tunnel (required when not on same LAN)
npx expo start --tunnel

# Run locally
npx expo start

# Lint
npm run lint
```

On Windows, `node` may not be in the default PATH. Use the full path:
```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
npx expo start --tunnel
```

## What Tourly Is

Mobile app for **professional tennis players** (ITF World Tennis Tour circuit) to manage their tournament schedule, deadlines, and travel expenses. Core domain concepts:

- **Tournaments** always start on Monday. Deadlines are fixed ITF offsets from `startDate`: singles entry −18 days, withdrawal −13 days, freeze/doubles −4 days. See `utils/deadlines.ts` for `calcDeadlines()`.
- **Surfaces**: `clay` (#FAEEDA bg), `hard` (#E6F1FB), `grass` (#EAF3DE). Always color-code UI by surface.
- **Prize money** is split into `singlesPrizeMoney` + `doublesPrizeMoney`. Use the sum of both; fall back to legacy `prizeMoney` for old records.
- **Dates** are stored as `"YYYY-MM-DD"` strings. Always parse with local midnight (not `new Date("YYYY-MM-DD")` which gives UTC midnight and causes off-by-one in negative-offset timezones). See the `parseLocalDate()` pattern used across screens.

## Architecture

### Data layer — `db.ts`
Single InstantDB client (`@instantdb/react-native`) initialized with the full schema. Import `db` from here for all reads and writes. Do not create a second client. Writes use `db.transact(db.tx.<entity>[id].update({...}))`.

### Demo mode — `config/demo.ts`
`DEMO_MODE = true` bypasses auth and injects static data into every screen. Toggle to `false` to use real InstantDB + require login.

- `useAppQuery` hook (`hooks/useAppQuery.ts`) wraps `db.useQuery` — returns `DEMO_DATA` when `DEMO_MODE` is on, otherwise passes through to InstantDB. All tab screens must use `useAppQuery`, not `db.useQuery` directly.
- Auth gate is removed from `app/_layout.tsx` while in demo mode — the layout goes straight to `(tabs)`.

### Routing — Expo Router v6
File-based. `app/(tabs)/` contains the five main screens; `unstable_settings.anchor = '(tabs)'` makes tabs the default route. Notification taps deep-link to `/(tabs)/tournaments?openTournament=<id>`.

### Notifications — `hooks/useNotificationSetup.ts`
Called once from the root layout. Requests push permissions, saves token to `db.devices['singleton-device']`, and reschedules local notifications whenever tournament data changes. Notification taps are intercepted here and navigate to the tournament detail.

### Shared utilities
- `utils/deadlines.ts` — `calcDeadlines`, `fmtDeadline`, `fmtDate`, `fmtDateRange`
- `utils/notifications.ts` — `requestPermissionsAndGetToken`, `rescheduleAllNotifications`
- `components/ui/` — reusable primitives (`CourtIcon`, `DatePickerField`, `IconSymbol`, etc.)

### Design tokens (inline, not from `constants/theme.ts`)
All screens use inline `StyleSheet.create`. The active design system is:
- Primary: `#5B5BD6` (indigo)
- Dark text: `#2D2B55`
- Background: `#FAFAFA`
- Danger: `#E24B4A`
- Success/positive net: `#2D9E6B`
- `constants/theme.ts` exists but is a leftover from the Expo template — not used by the app screens.

## Key Rules

- Always read versioned Expo docs at https://docs.expo.dev/versions/v54.0.0/ before writing Expo-specific code.
- All monetary values in USD.
- Screen-specific logic stays in `app/`; reusable primitives go in `components/ui/`.
- `TournamentDetail` and `AddTournamentModal` are exported from `app/(tabs)/tournaments.tsx` and imported by other screens — keep them there.
