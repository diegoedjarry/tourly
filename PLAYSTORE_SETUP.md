# Google Play Setup — Tourly

Everything needed to take Tourly from "developer registration accepted" to live on Google Play.

## What's already done in this repo

| Item | Where |
|---|---|
| Android package name | `com.diegojarry.tourly` (`app.json`) |
| EAS production build profile (auto-increments versionCode) | `eas.json` |
| EAS submit config for Play (internal track) | `eas.json` → `submit.production.android` |
| Play Store icon, 512×512 | `store-assets/play/icon-512.png` |
| Feature graphic, 1024×500 | `store-assets/play/feature-graphic-1024x500.png` |
| Privacy policy (covers Supabase, location, receipt photos) | `docs/privacy.html` |
| Store listing copy + Data Safety answers | below in this file |
| Service account key ignored by git | `.gitignore` |

## ⚠️ Important: closed testing requirement

Personal developer accounts created after Nov 13, 2023 **cannot publish straight to production**. Google requires a closed test with **at least 12 testers opted in continuously for 14 days** before you can apply for production access. Plan for this:

1. Publish first to **Internal testing** (instant, up to 100 testers) to sanity-check the build.
2. Promote to **Closed testing**, recruit 12+ testers (friends, other players — they opt in via a link), keep them enrolled 14 days.
3. Apply for production access from the Play Console dashboard, answering the questions about your test.

Details: [App testing requirements for new personal developer accounts](https://support.google.com/googleplay/android-developer/answer/14151465).

## Step 1 — Create the app in Play Console

[Play Console](https://play.google.com/console) → **Create app**:

- App name: **Tourly**
- Default language: **English (United States)**
- App or game: **App** · Free or paid: **Free**
- Accept the declarations → **Create app**

Then work through the **"Set up your app"** checklist on the dashboard. The answers:

- **Privacy policy URL**: host `docs/privacy.html` (e.g. GitHub Pages → `https://diegoedjarry.github.io/tourly/privacy.html`). Verify the URL loads publicly before pasting it.
- **App access**: the app requires login (email one-time code). Provide Google a demo account, **or** state that all features are available after a free signup with any email. If reviewers need instant access, consider providing credentials to a test account.
- **Ads**: No, the app contains no ads.
- **Content rating**: fill the questionnaire honestly (utility app, no violence/gambling/user communication) → results in **Everyone**.
- **Target audience**: 18+ is the simplest choice (professional athletes); avoids Families policy requirements.
- **News app**: No. **COVID-19 app**: No. **Data safety**: see Step 2. **Government app**: No.
- **Category**: Sports. Contact email: your developer email.

## Step 2 — Data Safety form

Based on what the app actually does:

| Data type | Collected? | Shared? | Purpose | Notes |
|---|---|---|---|---|
| Email address | Yes, required | No | Account management | Sign-in via one-time code (Supabase) |
| Name / profile info | Yes, optional | No | App functionality | Player profile |
| User-generated content (tournaments, expenses) | Yes | No | App functionality | Stored in Supabase |
| Photos | Yes, optional | No | App functionality | Receipt photo sent once for parsing; **processed ephemerally, not stored** — check the "ephemeral processing" box |
| Precise location | **No** | — | — | Used on-device only to center the map; never transmitted, so it does not count as "collected" |
| Device ID (push token) | Yes | No | App functionality | Deadline reminders |
| Crash logs & diagnostics | Yes | No | Analytics / stability | Sentry |

Global answers: data **encrypted in transit** — Yes. Users can **request deletion** — Yes (email per privacy policy).

Separate **Advertising ID** declaration: answer **No** (no ads, no ad SDKs). If Play flags that the uploaded AAB contains the `AD_ID` permission (a dependency can add it), block it in a config plugin or declare it honestly.

## Step 3 — Store listing

**Main store listing** → paste:

- **App name** (30 max): `Tourly`
- **Short description** (80 max):
  > Schedule, deadlines & expenses for pro tennis players on the ITF World Tour.
- **Full description** (4000 max):

  ```
  Tourly is the tournament manager built for professional tennis players
  competing on the ITF World Tennis Tour.

  PLAN YOUR SCHEDULE
  • See your season at a glance, color-coded by surface (clay, hard, grass)
  • Browse tournaments on an interactive map
  • Track prize money for singles and doubles

  NEVER MISS A DEADLINE
  • Automatic ITF deadlines for every tournament: singles entry, withdrawal,
    freeze and doubles sign-in
  • Push reminders before each deadline
  • Works offline — changes sync when you're back online

  CONTROL YOUR BUDGET
  • Log travel expenses per tournament in seconds
  • Snap a receipt and let Tourly read the amount, merchant and date
  • See your net result: prize money vs. expenses, tournament by tournament

  Built by people who know the circuit. Focus on your game — Tourly handles
  the admin.
  ```

- **Graphics**:
  - App icon: `store-assets/play/icon-512.png`
  - Feature graphic: `store-assets/play/feature-graphic-1024x500.png`
  - **Phone screenshots (required, 2–8)**: capture from a real device or emulator, portrait, 9:16 (e.g. 1080×1920+). Tabs worth showing: schedule, tournament detail with deadlines, map, expenses, net-result view.

## Step 4 — First build & manual upload

From your machine (needs `eas login` as `diegoedjarry`):

```bash
eas build --platform android --profile production
```

- EAS generates and stores the Android keystore for you on first run (accept the prompt). Nothing to manage locally.
- Output is an `.aab` signed with your upload key; **Play App Signing** (default for new apps) re-signs it for distribution.

**The very first upload must be manual** — the Play API can't create the first release:

1. Play Console → **Testing → Internal testing → Create new release**.
2. When asked about app signing, accept **Google-generated key** (default).
3. Upload the `.aab` downloaded from [expo.dev](https://expo.dev) builds page.
4. Add release notes, save, roll out to internal testers (add your own email to the tester list).

## Step 5 — Restrict the Maps API key (before wide release)

`app.json` ships a Google Maps key for `react-native-maps`. Once the app is on Play:

1. Play Console → **Test and release → App integrity → App signing** → copy the **App signing key certificate SHA-1** (and the upload key SHA-1).
2. Google Cloud Console → APIs & Services → Credentials → that key → **Application restrictions → Android apps** → add `com.diegojarry.tourly` + both SHA-1s.
3. API restriction: **Maps SDK for Android** only.

Without this, anyone can lift the key from the repo/APK and bill your account.

## Step 6 — Automate future submissions (optional but recommended)

1. Google Cloud Console → IAM & Admin → **Service Accounts** → create `tourly-play-publisher`, no roles needed at the project level.
2. Create a **JSON key**, save it as `playstore-service-account.json` in the repo root (it's git-ignored).
3. Play Console → **Users and permissions → Invite new user** → the service account's email → grant access to Tourly with **Release to testing tracks / production** permissions.
4. Wait ~24h for permissions to propagate on a fresh link, then:

```bash
eas submit --platform android --profile production
```

`eas.json` is already configured (`serviceAccountKeyPath`, `track: internal`). For later releases, one command does both:

```bash
eas build --platform android --profile production --auto-submit
```

Change `track` in `eas.json` as you graduate: `internal` → `alpha` (closed) → `production`.

## Step 7 — Closed test → production

1. Promote the internal release to a **Closed testing** track.
2. Recruit **12+ testers**; they opt in via the track's link and must stay opted in **14 continuous days** (they should install and actually use the app — Google reviews engagement).
3. After 14 days, the dashboard shows **Apply for production access** — answer the questionnaire about your testing.
4. Approval typically takes a few days. Then create a **Production** release (promote the same build or a newer one) and roll out.

First production review can take up to ~7 days for a new account; subsequent updates are usually reviewed in hours to a couple of days.

## Release checklist

- [ ] Privacy policy URL live and linked
- [ ] Store listing: descriptions, icon, feature graphic, 2+ screenshots
- [ ] Content rating, target audience, ads & Data Safety declared
- [ ] `.aab` built via `eas build -p android --profile production`
- [ ] First release uploaded manually to Internal testing
- [ ] Maps API key restricted to the package + SHA-1s
- [ ] Service account wired for `eas submit`
- [ ] Closed test running with 12+ testers for 14 days
- [ ] Production access granted → roll out
