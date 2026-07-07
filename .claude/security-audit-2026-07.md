# Tourly Security Audit — July 2026

Auditor: Claude (Fable 5) · Scope: full repo + live Supabase project · Method: 2-pass (discovery → systematic checklist)
Architecture: Expo 54 React Native client → Supabase (Postgres + RLS, Auth, 9 edge functions) · Python scraper on GitHub Actions · legacy InstantDB (push-token record only).

**Status legend**: verdicts reflect the state *found at audit time*. Items marked **[FIXED ✔]** were remediated during this same session; the original verdict is kept so the record is honest.

---

## 1. Security Posture Rating

**At time of audit: 🔴 CRITICAL → after this session's remediations: 🟠 NEEDS WORK (pending 3 owner actions below) → 🟡 once those are done.**

The codebase was in materially better shape than typical AI-assisted projects — RLS enabled on every table with an auto-enable event trigger, all edge functions JWT-validated with `getUser()`, no client-side service keys, lockfile committed, `.env` files properly ignored and never committed. However, two findings were genuinely critical: a **live service-role JWT committed to git** (in `scraper/.env.example`, whitelisted past .gitignore, plus hardcoded fallbacks in two Python files), and **SECURITY DEFINER share views with no `auth.uid()` predicate**, letting any signed-in user read every coach-share in the system. Both are code-fixed; the leaked key remains valid until rotated, which keeps the rating at 🟠.

### Owner actions required (cannot be done from code)
1. **ROTATE the Supabase service-role key** (Dashboard → Project Settings → API → "Reset" / generate new secret keys). The old JWT (`iat` 2026-06-14, `exp` ~2036) is in git history on a repo with a GitHub remote — treat it as compromised. Then update the `SUPABASE_SERVICE_KEY` GitHub Actions secret and `scraper/.env`.
2. **REVOKE the GitHub PAT** found pasted in `.env.local` (github_pat_11CF…) at github.com → Settings → Developer settings → Tokens. The client no longer needs any PAT (see F-03). The edge function uses its own server-side `GITHUB_TOKEN` secret — verify that one is a *fine-grained* token limited to Actions:write on the tourly repo, or reissue it as one.
3. **Purge git history** of `scraper/.env.example`'s old content (e.g. `git filter-repo --path scraper/.env.example --invert-paths` then force-push, or simpler: rely on rotation making the leaked key worthless — acceptable for a solo repo, but rotation is then mandatory).
4. Enable **leaked-password protection** (Dashboard → Auth → Passwords → check HaveIBeenPwned) — advisor-flagged.
5. **Restrict the Google Maps key** in `app.json` (Google Cloud Console → key restrictions → Android package name + SHA-1, iOS bundle id). Shipping a Maps key in the binary is normal; shipping it unrestricted is not.

---

## 2. Critical and High Findings

┌─────────────────────────────────────────────────────────┐
│ FINDING #F-01                                    [FIXED ✔ code] [ROTATION PENDING] │
├──────────┬──────────────────────────────────────────────┤
│ Severity │ CRITICAL                                     │
│ Category │ Secret Exposure — service-role key in git    │
│ Location │ scraper/.env.example:6, scraper/tourly_scraper.py:38-39, scraper/stress_test.py:15-16 │
│ CWE      │ CWE-798 (Use of Hard-coded Credentials)      │
├──────────┴──────────────────────────────────────────────┤
│ What's wrong: A real service-role JWT (role=service_role, exp ~2036) was     │
│ committed in the tracked `.env.example` (whitelisted via `!.env.example`)    │
│ and hardcoded as env-var fallbacks in two Python files, since commit 032346d.│
│ Why it matters: the service-role key bypasses ALL RLS. Anyone with repo read │
│ access can read/write/delete every user's data in the entire database.      │
│ The fix (applied): fallbacks removed — scraper now fails fast if env is      │
│ missing; .env.example rewritten with placeholders. Remaining: rotate the key │
│ (owner action #1) and optionally purge history (#3).                         │
│ Effort: ~10 min (rotation + secrets update)                                  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ FINDING #F-02                                                       [FIXED ✔] │
├──────────┬──────────────────────────────────────────────┤
│ Severity │ HIGH                                         │
│ Category │ Broken Access Control — cross-user data read │
│ Location │ DB views public.shared_tournaments / public.shared_expenses │
│ CWE      │ CWE-863 (Incorrect Authorization)            │
├──────────┴──────────────────────────────────────────────┤
│ What's wrong: both views were SECURITY DEFINER (bypassing RLS) and filtered  │
│ only on `sa.status = 'accepted'` — no `auth.uid()` predicate.               │
│ Why it matters: ANY authenticated user could `select * from shared_expenses`│
│ and read every tournament/expense any player had shared with any coach.     │
│ The fix (applied via migration security_hardening_shared_views_and_functions):│
│ views recreated with `and (sa.shared_with_id = auth.uid() or sa.owner_id =  │
│ auth.uid())`. Client code unaffected (it already filtered client-side).     │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ FINDING #F-03                                    [FIXED ✔ code] [REVOKE PENDING] │
├──────────┬──────────────────────────────────────────────┤
│ Severity │ HIGH                                         │
│ Category │ Public-prefix secret leak (design)           │
│ Location │ hooks/useScraperTrigger.ts:5 (was), .env.local:7-10 │
│ CWE      │ CWE-522 (Insufficiently Protected Credentials) │
├──────────┴──────────────────────────────────────────────┤
│ What's wrong: the app dispatched GitHub Actions using `EXPO_PUBLIC_GH_PAT` — │
│ an EXPO_PUBLIC_ var is compiled into the shipped JS bundle, readable by      │
│ anyone who unzips the app. A real-format PAT also sits pasted in .env.local. │
│ Why it matters: a leaked PAT allows triggering/abusing repo workflows (and   │
│ whatever else the token grants).                                             │
│ The fix (applied): client now calls the `trigger-player-scrape` edge         │
│ function; the GitHub token lives only server-side. Remaining: revoke the PAT │
│ (owner action #2).                                                           │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ FINDING #F-04                                                       [FIXED ✔] │
├──────────┬──────────────────────────────────────────────┤
│ Severity │ HIGH                                         │
│ Category │ Unauthenticated abusable endpoint            │
│ Location │ Edge function trigger-player-scrape (deployed, verify_jwt=false) │
│ CWE      │ CWE-306 (Missing Authentication for Critical Function) │
├──────────┴──────────────────────────────────────────────┤
│ What's wrong: publicly invokable function dispatched GitHub Actions runs for │
│ ANY player name in the request body, using the server's GitHub token.       │
│ Why it matters: anyone on the internet could flood the Actions queue / burn  │
│ CI minutes / scrape arbitrary players.                                       │
│ The fix (applied, deployed v4 + committed to repo): name-format validation, │
│ dispatch only for players an existing Tourly profile tracks, 15-min rate    │
│ limit persisted in scraper_runs. (Must stay JWT-less: a DB webhook calls it.)│
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ FINDING #F-05                                                       [FIXED ✔] │
├──────────┬──────────────────────────────────────────────┤
│ Severity │ HIGH                                         │
│ Category │ Vulnerable dependency                        │
│ Location │ package.json — xlsx ^0.18.5                  │
│ CWE      │ CWE-1321 (Prototype Pollution), CWE-1333 (ReDoS) │
├──────────┴──────────────────────────────────────────────┤
│ What's wrong: xlsx <0.19.3/<0.20.2 has two HIGH CVEs (GHSA-4r6h-8v6p-xvw6,   │
│ GHSA-5pgg-2g8v-p4x9); npm registry stopped at 0.18.5 so `npm audit fix`     │
│ can't resolve it. Used by utils/export-csv.ts and utils/import-expenses.ts  │
│ which parse user-supplied spreadsheets.                                      │
│ The fix (applied): upgraded to official SheetJS CDN build 0.20.3            │
│ (`xlsx@https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`); tsc clean.    │
└─────────────────────────────────────────────────────────┘

---

## 3. Quick Wins (mostly already applied)
- ✔ Deleted `.github/workflows/itf-scraper.yml` — a *deprecated* workflow still cron-scheduled daily, spending Anthropic credits against the legacy InstantDB stack.
- ✔ `delete_user_account()` now also wipes income, trip_estimates, coaching_messages, reflections, training_blocks, shared_access (was silently retaining them after "account deletion").
- ✔ Revoked PostgREST EXECUTE on trigger-only functions (`handle_new_user`, `rls_auto_enable`) and anon EXECUTE on `delete_user_account`.
- ✔ Pinned `search_path` on 3 advisor-flagged functions.
- ✔ `[AuthGate]` state logging (incl. user UUID) now `__DEV__`-only.
- ☐ Enable leaked-password protection (2 min, dashboard).
- ☐ Restrict Google Maps key (5 min, Google Cloud console).

## 4. Prioritized Remediation Plan (remaining items only)
1. **Rotate service-role key** — CRITICAL — ~10 min (owner).
2. **Revoke pasted GitHub PAT; verify server GITHUB_TOKEN is fine-grained** — HIGH — ~5 min (owner).
3. Enable leaked-password protection — MED — 2 min (owner).
4. Restrict Google Maps API key to app signatures — MED — 5 min (owner).
5. Add per-user daily caps to the 4 un-rate-limited Anthropic functions (parse-receipt, estimate-trip-cost, parse-excel, map-import-columns) — MED — ~45 min. Today an authenticated user can loop them and run up the Anthropic bill; the other 4 AI functions already have DB-backed limits.
6. Fail-fast env validation in lib/supabase.ts (throw a clear error when EXPO_PUBLIC_SUPABASE_URL/ANON_KEY missing instead of `!` assertions) — LOW — 10 min.
7. Gate DEMO_MODE on `__DEV__` or an EAS build-profile var so a stray env var can't ship an auth-bypassed production build — LOW (deliberate trade-off: demo TestFlight builds would need a change) — 10 min.
8. Move native session storage from AsyncStorage to an encrypted adapter (SecureStore-held key encrypting AsyncStorage, per Supabase RN docs) — LOW — ~1 h.
9. Validate/encode scraper-sourced `supervisorEmail`/`supervisorPhone` before `Linking.openURL` (tournaments.tsx:1203,1213) — LOW — 15 min.
10. Expo 54 → 57 upgrade to clear the 18 moderate transitive advisories (uuid/xcode via expo) — LOW/maintenance — hours, separate effort.
11. Git-history purge of the leaked key file (optional if rotated) — LOW after rotation.

## 5. What's Already Done Right (don't break these)
- **RLS everywhere**: all 14 public tables RLS-enabled, own-rows policies with `auth.uid()` and proper WITH CHECK; plus an `rls_auto_enable` event trigger that force-enables RLS on any future `CREATE TABLE`. Client-supplied `user_id` is harmless because WITH CHECK re-derives identity server-side.
- **All 9 edge functions validate the JWT with `getUser()`** (not `getSession()`), read the service key only from server env, allowlist inputs (media types, size caps, period/trigger enums), and 4 of them implement DB-backed rate limiting. Ownership checks like `.eq('user_id', user.id)` before AI spend in estimate-trip-cost.
- Anthropic keys exist **only** in edge-function env and GitHub Secrets — never client-side.
- `.env`/`.env.local` correctly ignored and never committed (verified across full history); lockfile committed; no hallucinated or unused dependencies.
- GitHub Actions use `${{ secrets.* }}` properly; scraper upserts via supabase-py (no SQL concatenation); the only client `.rpc()` takes zero arguments.
- No storage buckets to misconfigure — receipts stream base64 → edge function → Anthropic and are never persisted.
- OAuth token extraction clears tokens from the URL (`history.replaceState`) and never logs them.

## 6. Checklist Summary
1.1 ❌→✔ 1.2 ⚠️ 1.3 ❌→✔ 1.4 ⚠️→✔ 1.5 ✅ 1.6 ⚠️
2.1 ✅ 2.2 ✅ 2.3 ✅ 2.4 ✅ 2.5 ❌→✔(code) 2.6 ⬚ 2.7 ✅ 2.8 ❌→✔
3.1 ⚠️(RN: RLS is the enforcement — adequate) 3.2 ⚠️(DEMO_MODE) 3.3 ✅ 3.4 ✅ 3.5 ⚠️ 3.6 ✅ 3.7 ✅ 3.8 ⚠️(leaked-pw protection off)
4.1 ⚠️(manual allowlists, no schema lib) 4.2 ✅ 4.3 ⬚(RN; ⚠️ Linking note) 4.4 ✅ 4.5 ⚠️(upstream error bodies passed through) 4.6 ⬚(no signed webhooks; the one webhook-like endpoint hardened → ✔)
5.1 ❌→✔(2 HIGH fixed; 18 moderate deferred to Expo 57) 5.2 ✅ 5.3 ✅ 5.4 ⚠️ 5.5 ✅
6.1 ⚠️(4 of 8 AI functions unlimited) 6.2 ✅(platform limits; enable HIBP) 6.3 ✅(DB-backed, persistent)
7.1 ⚠️(no CORS headers in functions — functional gap for web, not an exposure) 7.2 ⬚
8.1 ✅(server re-validates type+size) 8.2 ⬚(no storage) 8.3 ⬚

*Full evidence (file:line quotes for every verdict) captured during discovery; ask Claude for any specific item's detail.*
