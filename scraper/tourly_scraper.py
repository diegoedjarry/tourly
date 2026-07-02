"""
Tourly ITF/ATP Scraper
----------------------
P1  — ITF tournament calendar:        ITF official API via browser (daily at 06:00 UTC)
P1b — ATP Challenger calendar:        ATP Tour JSON API via browser (same daily run)
P2  — Player profile:                 Tennis Abstract by player name (weekly on Monday)

Required env vars:
    SUPABASE_URL          — your Supabase project URL
    SUPABASE_SERVICE_KEY  — service-role key (bypasses RLS for scraper writes)
    PLAYER_NAME           — player's full name for ATP profile lookup (optional)
"""

import asyncio
import os
import re
import sys

# Force UTF-8 output on Windows so emoji/unicode in print() don't crash
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
from datetime import datetime, timezone, timedelta
from typing import Optional

from curl_cffi.requests import AsyncSession
from dotenv import load_dotenv
from playwright.async_api import async_playwright
from playwright_stealth import Stealth
from supabase import create_client, Client

load_dotenv()

# ── Hardcoded for testing — swap SUPABASE_SERVICE_KEY to secret key before prod ─
os.environ.setdefault("SUPABASE_URL", "https://bpxcizhgntucuhhyykqc.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJweGNpemhnbnR1Y3VoaHl5a3FjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTYzODg0OCwiZXhwIjoyMDk3MjE0ODQ4fQ.nzpHZ4kS4K16CqlomrAxURVWcuhFQtU9l324r7XuEiM")
os.environ.setdefault("PLAYER_NAME", "")

# ── Constants ──────────────────────────────────────────────────────────────────

ITF_CALENDAR_URL    = "https://www.itftennis.com/en/tournament-calendar/mens-world-tennis-tour/"
ITF_API_URL         = "https://www.itftennis.com/tennis/api/TournamentApi/GetCalendar"
ATP_SEARCH_URL      = "https://www.atptour.com/en/search/player-results"
ATP_PLAYER_BASE     = "https://www.atptour.com/en/players"
ATP_CHALLENGER_URL  = "https://www.atptour.com/en/tournaments?tourCodes=CH"
ATP_TOUR_API_BASE   = "https://www.atptour.com"

# Sofascore — fallback calendar source (ITF Men's category IDs)
SOFASCORE_API    = "https://api.sofascore.com/api/v1"
SOFASCORE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Referer": "https://www.sofascore.com/",
}

SURFACE_MAP = {
    "clay":         "clay",
    "hard":         "hard",
    "grass":        "grass",
    "carpet":       "hard",
    "indoor hard":  "hard",
    "outdoor hard": "hard",
    "clay (i)":     "clay",
    "hard (i)":     "hard",
}

DATE_FORMATS = ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d", "%d/%m/%Y", "%B %d, %Y", "%d %B %Y", "%d-%m-%Y", "%m/%d/%Y", "%d %b, %y")

HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept":          "application/json, text/html,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer":         "https://www.atptour.com/",
}

BROWSER_ARGS = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
]

# ── Helpers ────────────────────────────────────────────────────────────────────

def normalise_date(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    raw = raw.strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def parse_prize(raw: Optional[str]) -> Optional[float]:
    if not raw:
        return None
    digits = re.sub(r"[^\d.]", "", str(raw).replace(",", ""))
    try:
        return float(digits) if digits else None
    except ValueError:
        return None


def normalise_surface(raw: Optional[str]) -> str:
    if not raw:
        return "hard"
    return SURFACE_MAP.get(raw.strip().lower(), "hard")


# ── Tournament Scraper (ITF via direct HTTP) ───────────────────────────────────

class ITFTournamentScraper:
    """
    Fetches the ITF Men's World Tennis Tour calendar from Sofascore's public API.
    Uses scheduled-events by date to collect all tennis tournaments day-by-day,
    then filters for ITF and Challenger events.
    """

    ITF_KEYWORDS = ("itf", "challenger", "world tennis tour", "m15", "m25", "m60", "m80", "m100")

    async def scrape_calendar(self) -> list[dict]:
        print("📡  Fetching ITF tournament calendar via browser (official ITF API)...")
        tournaments = await self._fetch_itf_via_browser()
        if tournaments:
            print(f"   ✓  ITF browser returned {len(tournaments)} tournaments.")
            return tournaments
        print("   ⚠  ITF browser returned nothing — falling back to Wikipedia...")
        return await self._fetch_wikipedia()

    async def _fetch_itf_via_browser(self) -> list[dict]:
        """
        Opens the ITF calendar page in a real browser (bypasses Incapsula),
        intercepts every GetCalendar XHR call, and collects all pages of results.
        Navigates month-by-month for the next 12 months to get full future calendar.
        """
        captured_items: list[dict] = []

        async def intercept(route):
            try:
                resp = await route.fetch()
                url = route.request.url
                if "GetCalendar" in url and "Filter" not in url and "itftennis" in url:
                    try:
                        body = await resp.json()
                        items = body.get("items", [])
                        if items:
                            captured_items.extend(items)
                            print(f"   +{len(items)} from {url[url.find('dateFrom'):url.find('dateFrom')+30]}")
                    except Exception:
                        pass
                await route.fulfill(response=resp)
            except Exception:
                await route.continue_()

        today = datetime.now(timezone.utc)

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True, channel="chrome", args=BROWSER_ARGS)
            ctx = await browser.new_context(
                user_agent=HTTP_HEADERS["User-Agent"],
                viewport={"width": 1280, "height": 900},
                locale="en-US",
            )
            page = await ctx.new_page()
            await Stealth().apply_stealth_async(page)
            await page.route("**/itftennis.com/**", intercept)
            # Block ads/analytics to speed up page load
            await page.route("**/(doubleclick|google-analytics|facebook|googletagmanager).**", lambda r: r.abort())

            # Load the calendar page once to establish session/cookies
            try:
                await page.goto(
                    "https://www.itftennis.com/en/tournament-calendar/mens-world-tennis-tour-calendar/",
                    wait_until="domcontentloaded", timeout=50_000
                )
                await page.wait_for_timeout(6_000)
            except Exception as e:
                print(f"   ⚠  ITF page nav: {e}")

            # Now call the API directly for each future month using page.evaluate
            base_url = "https://www.itftennis.com/tennis/api/TournamentApi/GetCalendar"
            for month_offset in range(0, 12):
                dt = datetime(today.year, today.month, 1) + timedelta(days=32 * month_offset)
                first = datetime(dt.year, dt.month, 1)
                # last day of month
                if dt.month == 12:
                    last = datetime(dt.year + 1, 1, 1) - timedelta(days=1)
                else:
                    last = datetime(dt.year, dt.month + 1, 1) - timedelta(days=1)

                date_from = first.strftime("%Y-%m-%d")
                date_to = last.strftime("%Y-%m-%d")
                api_url = (
                    f"{base_url}?circuitCode=MT&searchString=&skip=0&take=200"
                    f"&nationCodes=&zoneCodes=&dateFrom={date_from}&dateTo={date_to}"
                    f"&surfaces=&indoorOutdoor=&categories=&drawSizes="
                )
                try:
                    result = await page.evaluate(f"""async () => {{
                        const r = await fetch('{api_url}', {{
                            headers: {{'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest'}}
                        }});
                        return await r.json();
                    }}""")
                    items = result.get("items", []) if isinstance(result, dict) else []
                    if items:
                        captured_items.extend(items)
                        print(f"   {date_from}: +{len(items)} tournaments (total {result.get('totalItems')})")
                    else:
                        print(f"   {date_from}: 0 tournaments")
                except Exception as e:
                    print(f"   {date_from}: fetch error — {e}")

            await browser.close()

        print(f"   Raw items captured: {len(captured_items)}")
        # Deduplicate by tournamentKey and normalise
        seen: set[str] = set()
        tournaments = []
        for item in captured_items:
            tid = item.get("tournamentKey") or item.get("id") or ""
            tid = str(tid)
            if not tid or tid in seen:
                continue
            seen.add(tid)
            surface_raw = item.get("surfaceDesc") or item.get("surfaceCode") or ""
            tournaments.append({
                "itf_id":            tid,
                "name":              item.get("tournamentName") or item.get("name") or "",
                "city":              item.get("venue") or item.get("location"),
                "country":           item.get("hostNation"),
                "surface":           normalise_surface(surface_raw),
                "category":          item.get("category"),
                "start_date":        normalise_date(item.get("startDate")),
                "end_date":          normalise_date(item.get("endDate")),
                "prize_money_total": parse_prize(item.get("prizeMoney")),
                "is_auto_populated": True,
            })
        return [t for t in tournaments if t["name"] and t["start_date"]]

    async def _fetch_wikipedia(self) -> list[dict]:
        """
        Fetches the 2026 ITF Men's World Tennis Tour quarterly sub-pages from
        Wikipedia via the MediaWiki API and parses tournament cells.

        Cell format: [[City]], Country<br /> Surface <br /> M25/M15 <br /> [url draws]
        Date cells: |rowspan=N|Month Day  (e.g. |rowspan=14|January 5)
        """
        import re as _re

        year = datetime.now(timezone.utc).year
        subpages = [
            f"{year}_ITF_Men%27s_World_Tennis_Tour_(January%E2%80%93March)",
            f"{year}_ITF_Men%27s_World_Tennis_Tour_(April%E2%80%93June)",
            f"{year}_ITF_Men%27s_World_Tennis_Tour_(July%E2%80%93September)",
            f"{year}_ITF_Men%27s_World_Tennis_Tour_(October%E2%80%93December)",
        ]
        tournaments = []
        seen: set[str] = set()

        # Regex for the "Week of" date cell: |rowspan=N|Month Day  or just |Month Day
        date_cell_re = _re.compile(
            r"(?:rowspan=\d+\|)?(\w+)\s+(\d{1,2})\s*$"
        )
        # Tournament cell: [[City]], Country<br /> Surface <br /> Category
        tourn_cell_re = _re.compile(
            r"\[\[([^\]]+)\]\],?\s*([^\n<]+)<br\s*/?>",
            _re.IGNORECASE
        )
        surface_re = _re.compile(r"\b(clay|hard|grass|carpet)\b", _re.IGNORECASE)
        cat_re = _re.compile(r"\b(M\d+|W\d+)\b")

        month_map = {
            "january": 1, "february": 2, "march": 3, "april": 4,
            "may": 5, "june": 6, "july": 7, "august": 8,
            "september": 9, "october": 10, "november": 11, "december": 12,
        }

        try:
            async with AsyncSession(impersonate="chrome120") as client:
                for subpage in subpages:
                    url = (
                        f"https://en.wikipedia.org/w/api.php?action=parse"
                        f"&page={subpage}&prop=wikitext&format=json"
                    )
                    r = await client.get(url, timeout=20)
                    if r.status_code != 200:
                        print(f"   Subpage 404: {subpage}")
                        continue
                    d = r.json()
                    if "error" in d:
                        print(f"   Subpage missing: {subpage}")
                        continue

                    wikitext = d["parse"]["wikitext"]["*"]
                    print(f"   Subpage len={len(wikitext)}: {subpage[:60]}")

                    # Walk lines; track current week date
                    current_month = None
                    current_day = None
                    lines = wikitext.splitlines()

                    for i, line in enumerate(lines):
                        stripped = line.strip()

                        # Detect "Week of" date rows: |rowspan=14|January 5
                        dm = date_cell_re.search(stripped.lstrip("|").strip())
                        if dm and stripped.startswith("|") and not stripped.startswith("|-"):
                            month_name = dm.group(1).lower()
                            if month_name in month_map:
                                current_month = month_map[month_name]
                                current_day = int(dm.group(2))
                                continue

                        # Tournament cells ALWAYS have the background color style.
                        # Player/result cells never do — use this as the discriminator.
                        is_tournament_cell = (
                            "background:lightblue" in stripped or
                            "background:#f0f8ff" in stripped or
                            "background:lightgreen" in stripped
                        )
                        if is_tournament_cell and "[[" in stripped and "<br" in stripped.lower() and current_month:
                            tm = tourn_cell_re.search(stripped)
                            if not tm:
                                continue
                            city_raw = tm.group(1).strip()
                            country_raw = tm.group(2).strip()

                            # Strip wikilink pipe: [[Foo|Bar]] -> Bar
                            city = city_raw.split("|")[-1]
                            country = _re.sub(r"\[\[|\]\]", "", country_raw).strip(", ")

                            # Surface
                            sm = surface_re.search(stripped)
                            surface = normalise_surface(sm.group(1)) if sm else None

                            # Category (M25, M15, etc.)
                            cm = cat_re.search(stripped)
                            category = cm.group(1) if cm else "ITF Men's"

                            # Build start_date from current week tracking
                            try:
                                start_date = datetime(year, current_month, current_day).strftime("%Y-%m-%d")
                            except ValueError:
                                continue

                            name = f"{city}, {country}" if country else city
                            # Dedupe by name+date
                            tid = f"wiki_{year}_{name[:35].replace(' ', '_')}_{start_date}"
                            if tid in seen:
                                continue
                            seen.add(tid)

                            tournaments.append({
                                "itf_id":            tid,
                                "name":              name,
                                "city":              city,
                                "country":           country,
                                "surface":           surface,
                                "category":          category,
                                "start_date":        start_date,
                                "end_date":          None,
                                "prize_money_total": None,
                                "is_auto_populated": True,
                            })

        except Exception as e:
            print(f"   ⚠  Wikipedia fetch failed: {e}")

        return tournaments


# ── ATP Challenger Scraper ────────────────────────────────────────────────────

class ATPChallengerScraper:
    """
    Fetches the ATP Challenger tournament calendar.

    Strategy:
    1. Primary:  ATP Tour website (atptour.com/en/tournaments?tourCodes=CH) via
                 Playwright + stealth.  Intercepts the XHR calls that power the
                 tournament grid and parses the JSON payload.
    2. Fallback: ITF API with circuitCode=CH (Challenger events also appear in
                 the ITF system under the CH circuit code).

    Category normalisation:
    - Maps ATP prize-money tiers to the app's canonical strings
      ("Challenger 50", "Challenger 75", "Challenger 100", "Challenger 125",
       "Challenger 175") so that `getCircuit()` in deadlines.ts recognises them.

    Deadlines (from utils/deadlines.ts — CHALLENGER_DEADLINES):
    - signUpDeadline:      start_date − 21 days  (Mon, 12:00 PM ET)
    - freezeDeadline:      start_date − 7 days   (Mon, 12:00 PM ET)
    - withdrawalDeadline:  start_date − 3 days   (Fri, 10:00 AM ET)
    These are *not* stored by the scraper; they are computed at read time by
    calcDeadlines() in the app.  The scraper stores only name/dates/surface/prize.
    """

    # Prize-money thresholds → canonical Challenger category label
    # Based on ATP Challenger tier structure (approximate USD prize fund)
    _PRIZE_TIERS = [
        (175_000, "Challenger 175"),
        (125_000, "Challenger 125"),
        (100_000, "Challenger 100"),
        (75_000,  "Challenger 75"),
        (50_000,  "Challenger 50"),
    ]

    # Surface codes ATP uses in their API responses
    _ATP_SURFACE_MAP = {
        "clay":          "clay",
        "hard":          "hard",
        "grass":         "grass",
        "hard (i)":      "hard",
        "clay (i)":      "clay",
        "carpet":        "hard",
        "carpet (i)":    "hard",
    }

    def _normalise_category(self, prize_raw: Optional[str], category_raw: Optional[str] = None) -> str:
        """
        Map a prize-money string or raw category label to a canonical
        Challenger category string the app's getCircuit() will recognise.
        """
        # If the source already provides a structured category string, try it first
        if category_raw:
            cat_lower = category_raw.lower().strip()
            for threshold, label in self._PRIZE_TIERS:
                tier_str = label.lower().replace("challenger ", "")  # "175"
                if tier_str in cat_lower:
                    return label
            if "challenger" in cat_lower:
                return "Challenger 50"  # default tier when amount unclear

        # Fall back to prize money parsing
        prize = parse_prize(prize_raw)
        if prize is not None:
            for threshold, label in self._PRIZE_TIERS:
                if prize >= threshold:
                    return label
        return "Challenger 50"

    async def scrape_calendar(self) -> list[dict]:
        print("📡  Fetching ATP Challenger calendar (primary: ATP Tour website)...")
        tournaments = await self._fetch_via_browser()
        if tournaments:
            print(f"   ✓  ATP browser returned {len(tournaments)} Challenger tournaments.")
            return tournaments
        print("   ⚠  ATP browser returned nothing — falling back to ITF API (circuitCode=CH)...")
        return await self._fetch_itf_challenger_fallback()

    async def _fetch_via_browser(self) -> list[dict]:
        """
        Open the ATP Challenger calendar page in a stealth browser, intercept
        the JSON API calls the page makes for tournament data, and collect results
        month-by-month for the next 12 months.

        ATP Tour uses a Next.js / React frontend that calls internal endpoints like:
          /api/tournament-schedule?tourCode=CH&year=YYYY
        or populates the page with embedded __NEXT_DATA__ JSON.  We try both approaches:
        1. Intercept any XHR/fetch that returns a list of tournaments.
        2. If interception yields nothing, read __NEXT_DATA__ from the page DOM.
        """
        captured: list[dict] = []

        async def intercept(route):
            try:
                resp = await route.fetch()
                url  = route.request.url
                # ATP's internal schedule API — capture anything that looks like it
                if any(kw in url for kw in ("tournament-schedule", "tourCode=CH", "challengers", "schedule")):
                    try:
                        body = await resp.json()
                        # ATP API shapes vary; handle both list and dict wrappers
                        if isinstance(body, list):
                            if body and isinstance(body[0], dict) and ("name" in body[0] or "tournamentName" in body[0]):
                                captured.extend(body)
                                print(f"   +{len(body)} from ATP API (list): {url[:80]}")
                        elif isinstance(body, dict):
                            for key in ("tournaments", "data", "results", "items"):
                                items = body.get(key)
                                if isinstance(items, list) and items:
                                    captured.extend(items)
                                    print(f"   +{len(items)} from ATP API ({key}): {url[:80]}")
                                    break
                    except Exception:
                        pass
                await route.fulfill(response=resp)
            except Exception:
                await route.continue_()

        today = datetime.now(timezone.utc)

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True, channel="chrome", args=BROWSER_ARGS)
            ctx = await browser.new_context(
                user_agent=HTTP_HEADERS["User-Agent"],
                viewport={"width": 1280, "height": 900},
                locale="en-US",
            )
            page = await ctx.new_page()
            await Stealth().apply_stealth_async(page)
            await page.route("**/*", intercept)
            await page.route("**/(doubleclick|google-analytics|facebook|googletagmanager).**", lambda r: r.abort())

            # ── Step 1: load the page to establish session and trigger initial XHRs ──
            try:
                await page.goto(
                    ATP_CHALLENGER_URL,
                    wait_until="domcontentloaded", timeout=50_000,
                )
                await page.wait_for_timeout(6_000)
            except Exception as e:
                print(f"   ⚠  ATP page nav: {e}")

            # ── Step 2: if interception got nothing, try reading __NEXT_DATA__ ──
            if not captured:
                try:
                    next_data_raw = await page.evaluate(
                        "() => document.getElementById('__NEXT_DATA__')?.textContent || ''"
                    )
                    if next_data_raw:
                        import json as _json
                        next_data = _json.loads(next_data_raw)
                        # Walk the page props to find tournament arrays
                        def find_arrays(obj, depth=0):
                            if depth > 8:
                                return
                            if isinstance(obj, list) and len(obj) > 0 and isinstance(obj[0], dict):
                                first = obj[0]
                                if any(k in first for k in ("name", "tournamentName", "tournamentSlug")):
                                    captured.extend(obj)
                                    print(f"   +{len(obj)} from __NEXT_DATA__")
                            elif isinstance(obj, dict):
                                for v in obj.values():
                                    find_arrays(v, depth + 1)
                        find_arrays(next_data)
                except Exception as e:
                    print(f"   ⚠  __NEXT_DATA__ parse error: {e}")

            # ── Step 3: try year-based API calls directly from the page context ──
            # ATP Tour exposes /api/v1/tournaments?tourCode=CH&year=YYYY on some versions
            years_to_fetch = sorted({today.year, today.year + 1})
            for year in years_to_fetch:
                candidate_urls = [
                    f"https://www.atptour.com/api/tournament-schedule?tourCode=CH&year={year}",
                    f"https://www.atptour.com/api/v1/tournaments?tourCode=CH&year={year}",
                    f"https://www.atptour.com/en/scores/current-ytd-results?tourId=CH&pageName=tournaments&year={year}",
                ]
                for api_url in candidate_urls:
                    try:
                        result = await page.evaluate(f"""async () => {{
                            try {{
                                const r = await fetch('{api_url}', {{
                                    headers: {{
                                        'Accept': 'application/json',
                                        'X-Requested-With': 'XMLHttpRequest',
                                        'Referer': 'https://www.atptour.com/'
                                    }}
                                }});
                                if (!r.ok) return null;
                                return await r.json();
                            }} catch (e) {{ return null; }}
                        }}""")
                        if result is None:
                            continue
                        items = []
                        if isinstance(result, list):
                            items = result
                        elif isinstance(result, dict):
                            for key in ("tournaments", "data", "results", "items"):
                                if isinstance(result.get(key), list):
                                    items = result[key]
                                    break
                        if items:
                            captured.extend(items)
                            print(f"   {year}: +{len(items)} from {api_url[:70]}")
                            break  # found a working URL for this year
                    except Exception as e:
                        print(f"   {year} API {api_url[:60]}: {e}")

            await browser.close()

        if not captured:
            return []

        # ── Normalise captured items ───────────────────────────────────────────
        # ATP API field names vary between endpoints; handle the most common shapes.
        seen: set[str] = set()
        tournaments = []
        for item in captured:
            if not isinstance(item, dict):
                continue

            # ID — prefer tournamentId / id / slug
            tid = (
                str(item.get("tournamentId") or item.get("id") or "")
                or item.get("tournamentSlug") or item.get("slug") or ""
            )
            if not tid:
                continue
            # Prefix to avoid collisions with ITF IDs
            atp_id = f"atp_ch_{tid}"
            if atp_id in seen:
                continue
            seen.add(atp_id)

            name = (
                item.get("tournamentName") or item.get("name") or
                item.get("title") or item.get("tournament") or ""
            ).strip()

            city = (
                item.get("city") or item.get("location") or
                item.get("venue") or item.get("country") or ""
            ).strip()

            country = (
                item.get("country") or item.get("countryCode") or
                item.get("nation") or ""
            ).strip()

            surface_raw = (
                item.get("surface") or item.get("surfaceDesc") or
                item.get("courtSurface") or ""
            )
            surface = normalise_surface(surface_raw)

            start_date = normalise_date(
                item.get("startDate") or item.get("start_date") or
                item.get("dateFrom") or item.get("date") or ""
            )
            end_date = normalise_date(
                item.get("endDate") or item.get("end_date") or
                item.get("dateTo") or ""
            )

            prize_raw = str(
                item.get("prizeMoney") or item.get("prize_money") or
                item.get("totalPrizeMoney") or item.get("purse") or ""
            )
            prize = parse_prize(prize_raw)

            category_raw = str(item.get("category") or item.get("tier") or item.get("type") or "")
            category = self._normalise_category(prize_raw, category_raw)

            if not name or not start_date:
                continue

            tournaments.append({
                "itf_id":            atp_id,
                "name":              name,
                "city":              city or None,
                "country":           country or None,
                "surface":           surface,
                "category":          category,
                "start_date":        start_date,
                "end_date":          end_date,
                "prize_money_total": prize,
                "is_auto_populated": True,
            })

        return tournaments

    async def _fetch_itf_challenger_fallback(self) -> list[dict]:
        """
        Fallback: call the ITF GetCalendar API with circuitCode=CH (ATP Challengers
        are co-sanctioned with the ITF and appear in their system).
        Uses the same browser session pattern as ITFTournamentScraper.
        """
        print("   Trying ITF API with circuitCode=CH...")
        captured_items: list[dict] = []
        today = datetime.now(timezone.utc)

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True, channel="chrome", args=BROWSER_ARGS)
            ctx = await browser.new_context(
                user_agent=HTTP_HEADERS["User-Agent"],
                viewport={"width": 1280, "height": 900},
                locale="en-US",
            )
            page = await ctx.new_page()
            await Stealth().apply_stealth_async(page)

            # Warm up the session on the ITF site to get valid cookies/tokens
            try:
                await page.goto(
                    "https://www.itftennis.com/en/tournament-calendar/mens-world-tennis-tour-calendar/",
                    wait_until="domcontentloaded", timeout=50_000,
                )
                await page.wait_for_timeout(4_000)
            except Exception as e:
                print(f"   ⚠  ITF warmup nav: {e}")

            base_url = ITF_API_URL
            for month_offset in range(0, 12):
                dt = datetime(today.year, today.month, 1) + timedelta(days=32 * month_offset)
                first = datetime(dt.year, dt.month, 1)
                if dt.month == 12:
                    last = datetime(dt.year + 1, 1, 1) - timedelta(days=1)
                else:
                    last = datetime(dt.year, dt.month + 1, 1) - timedelta(days=1)

                date_from = first.strftime("%Y-%m-%d")
                date_to   = last.strftime("%Y-%m-%d")

                # circuitCode=CH is the ATP Challenger circuit in the ITF system
                api_url = (
                    f"{base_url}?circuitCode=CH&searchString=&skip=0&take=200"
                    f"&nationCodes=&zoneCodes=&dateFrom={date_from}&dateTo={date_to}"
                    f"&surfaces=&indoorOutdoor=&categories=&drawSizes="
                )
                try:
                    result = await page.evaluate(f"""async () => {{
                        const r = await fetch('{api_url}', {{
                            headers: {{'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest'}}
                        }});
                        return await r.json();
                    }}""")
                    items = result.get("items", []) if isinstance(result, dict) else []
                    if items:
                        captured_items.extend(items)
                        print(f"   {date_from}: +{len(items)} Challenger (ITF/CH)")
                    else:
                        print(f"   {date_from}: 0 Challenger tournaments")
                except Exception as e:
                    print(f"   {date_from}: ITF/CH fetch error — {e}")

            await browser.close()

        print(f"   ITF/CH raw items: {len(captured_items)}")
        seen: set[str] = set()
        tournaments = []
        for item in captured_items:
            tid = str(item.get("tournamentKey") or item.get("id") or "")
            if not tid or tid in seen:
                continue
            seen.add(tid)

            surface_raw = item.get("surfaceDesc") or item.get("surfaceCode") or ""
            prize_raw   = str(item.get("prizeMoney") or "")
            cat_raw     = str(item.get("category") or "")

            tournaments.append({
                "itf_id":            f"atp_ch_{tid}",
                "name":              item.get("tournamentName") or item.get("name") or "",
                "city":              item.get("venue") or item.get("location"),
                "country":           item.get("hostNation"),
                "surface":           normalise_surface(surface_raw),
                "category":          self._normalise_category(prize_raw, cat_raw),
                "start_date":        normalise_date(item.get("startDate")),
                "end_date":          normalise_date(item.get("endDate")),
                "prize_money_total": parse_prize(prize_raw),
                "is_auto_populated": True,
            })
        return [t for t in tournaments if t["name"] and t["start_date"]]


# ── Player Scraper (Tennis Abstract) ──────────────────────────────────────────

class TennisAbstractScraper:
    """
    Scrapes player profiles from Tennis Abstract (tennisabstract.com).

    Strategy per player type:
    - ITF/Challenger players: page loads jsfrags/{Slug}.js which contains pre-rendered
      HTML tables (recent-results, year-end-rankings). Ranking is in var currentrank=N.
    - Profile ranking fallback: jsplayers/curr_rank_atp.js has a currRank dict for all
      ATP-ranked players.

    Name → slug conversion: strip accents, remove spaces, try full name first then
    drop last surname part (e.g. "Diego Jarry Fillol" → "DiegoJarryFillol").
    """

    TA_BASE       = "https://www.tennisabstract.com"
    CURR_RANK_URL = "https://www.tennisabstract.com/jsplayers/curr_rank_atp.js"

    # Ordering used to track deepest round played (not wins)
    _ROUND_WINS = {"W": 6, "F": 5, "SF": 4, "QF": 3, "R16": 2, "R32": 1, "R64": 0, "R128": 0}

    # When a player WINS round R, they advance to _NEXT_ROUND[R].
    # Points are awarded for the round advanced TO, not the round won in.
    _NEXT_ROUND = {"R64": "R32", "R32": "R16", "R16": "QF", "QF": "SF", "SF": "F", "F": "W"}

    def __init__(self):
        self._curr_rank_cache: Optional[dict] = None

    # ── public entry point ────────────────────────────────────────────────────

    async def scrape_player(self, player_name: str, store_name: Optional[str] = None) -> Optional[dict]:
        """
        Scrape a player from Tennis Abstract.
        store_name: name to persist in player_profiles.player_name (defaults to player_name).
        """
        import unicodedata

        print(f"\n📡  Tennis Abstract scrape for '{player_name}'...")

        # ── Step 1: build slug candidates ─────────────────────────────────────
        # Strip accents: "Jarry Fillol" → "Jarry Fillol" (already ASCII), "Ñ" → "N"
        def to_slug(name: str) -> str:
            norm = unicodedata.normalize("NFKD", name)
            ascii_name = "".join(c for c in norm if not unicodedata.combining(c))
            return ascii_name.replace(" ", "").replace("-", "")

        parts = player_name.split()
        slugs: list[str] = []
        # Try full name first, then progressively drop the last name part
        for end in range(len(parts), 0, -1):
            slug = to_slug(" ".join(parts[:end]))
            if slug not in slugs:
                slugs.append(slug)

        # ── Step 2: fetch page HTML and jsfrags to get ranking + match data ──
        current_ranking: Optional[int] = None
        fullname: Optional[str] = None
        match_rows: list[list[str]] = []
        year_end_rows: list[list[str]] = []
        working_slug: Optional[str] = None

        headers = {
            "User-Agent": HTTP_HEADERS["User-Agent"],
            "Accept": "text/html,application/xhtml+xml,*/*;q=0.9",
            "Referer": self.TA_BASE + "/",
        }

        async with AsyncSession(impersonate="chrome120") as client:
            for slug in slugs:
                url = f"{self.TA_BASE}/cgi-bin/player.cgi?p={slug}"
                try:
                    r = await client.get(url, headers=headers, timeout=20)
                except Exception as e:
                    print(f"   ⚠  HTTP error for {slug}: {e}")
                    continue

                if r.status_code == 429:
                    print(f"   ⚠  Rate limited — waiting 30s...")
                    await asyncio.sleep(30)
                    r = await client.get(url, headers=headers, timeout=20)

                if r.status_code != 200:
                    print(f"   {slug}: HTTP {r.status_code} — skipping")
                    continue

                html = r.text
                title_m = re.search(r"<title>Tennis Abstract:\s*([^<]+?)\s*Match Results", html)
                if not title_m:
                    print(f"   {slug}: page has no TA title — skipping")
                    continue

                fullname = title_m.group(1).strip()
                print(f"   ✓  Found page for '{fullname}' (slug: {slug})")

                # Extract currentrank from inline script
                cr_m = re.search(r"var\s+currentrank\s*=\s*(\d+)", html)
                if cr_m:
                    current_ranking = int(cr_m.group(1))
                    print(f"   Ranking from page: {current_ranking}")

                # Check if this is a jsfrags-style page (has pre-rendered tables).
                # If HTML doesn't reference jsfrags, try {slug}.js directly as fallback
                # (happens when atp_player_name uses a shorter slug than the full-name slug).
                frag_m = re.search(r"jsfrags/([^'\"]+\.js)", html)
                frag_filename = frag_m.group(1) if frag_m else f"{slug}.js"
                frag_url = f"{self.TA_BASE}/jsfrags/{frag_filename}"
                print(f"   Fetching jsfrags: {frag_url}")
                try:
                    rf = await client.get(frag_url, headers=headers, timeout=20)
                    if rf.status_code == 200:
                        frag_html = rf.text
                        # The frag is: var player_frag = `...html...`
                        frag_content_m = re.search(r"var\s+player_frag\s*=\s*`([\s\S]*?)`", frag_html)
                        if frag_content_m:
                            frag_content = frag_content_m.group(1)
                            match_rows    = self._parse_html_table(frag_content, "recent-results")
                            year_end_rows = self._parse_html_table(frag_content, "year-end-rankings")
                            print(f"   Match rows: {len(match_rows)}, year-end rows: {len(year_end_rows)}")
                    else:
                        print(f"   ⚠  jsfrags HTTP {rf.status_code} — no match history for {slug}")
                except Exception as e:
                    print(f"   ⚠  jsfrags fetch error: {e}")

                working_slug = slug
                break  # found a valid player page

        # ── Step 3: fallback ranking from curr_rank_atp.js ───────────────────
        if current_ranking is None:
            current_ranking = await self._lookup_curr_rank(player_name)
            if current_ranking:
                print(f"   Ranking from currRank fallback: {current_ranking}")

        # ── Step 4: last resort — most recent rankingThatWeek from match rows ──
        # Handles players just entering rankings who aren't yet in the cache.
        if current_ranking is None and match_rows:
            mh_temp = self._build_match_history(match_rows)
            for entry in mh_temp:
                rk = entry.get("rankingThatWeek")
                if rk and isinstance(rk, int) and rk > 0:
                    current_ranking = rk
                    print(f"   Ranking from most-recent match entry: {current_ranking}")
                    break

        if current_ranking is None:
            print(f"   ⚠  No ranking found for '{player_name}'")

        # ── Step 4: build ranking evolution from year-end-rankings table ─────
        ranking_evolution = self._parse_year_end_rankings(year_end_rows)

        # ── Step 5: group match rows into tournament history ──────────────────
        # recent-results headers (from debug):
        # [Date, Tournament, Surface, Rd, Rk, vRk, Score, DR, A%, DF%, 1stIn, 1st%, 2nd%, BPSvd, Time]
        # col indices: 0=date, 1=tourn, 2=surf, 3=round, 4=player_rank, 5=opp_rank, 6=score_desc
        match_history = self._build_match_history(match_rows)

        win_loss         = self._calc_win_loss(match_history)
        points_defending = self._calc_defending_points(match_history)

        return {
            "ipin":                working_slug or player_name,
            "player_name":         store_name or player_name,
            "current_ranking":     current_ranking,
            "ranking_evolution":   ranking_evolution,
            "win_loss_by_surface": win_loss,
            "match_history":       match_history,
            "points_defending":    points_defending,
            "last_updated":        datetime.now(timezone.utc).isoformat(),
        }

    # ── HTML table parser ──────────────────────────────────────────────────────

    def _parse_html_table(self, html: str, table_id: str) -> list[list[str]]:
        """Extract data rows (skip header) from a table with the given id in raw HTML."""
        from html.parser import HTMLParser

        class TableParser(HTMLParser):
            def __init__(self, target_id: str):
                super().__init__()
                self.target_id = target_id
                self.in_target = False
                self.depth = 0
                self.rows: list[list[str]] = []
                self._cur_row: list[str] = []
                self._cur_cell: list[str] = []
                self._in_cell = False
                self._header_done = False

            def handle_starttag(self, tag, attrs):
                adict = dict(attrs)
                if tag == "table" and adict.get("id") == self.target_id:
                    self.in_target = True
                    self.depth = 1
                elif self.in_target:
                    if tag == "table":
                        self.depth += 1
                    elif tag in ("tr",) and self.depth == 1:
                        self._cur_row = []
                    elif tag in ("td", "th") and self.depth == 1:
                        self._in_cell = True
                        self._cur_cell = []

            def handle_endtag(self, tag):
                if not self.in_target:
                    return
                if tag == "table":
                    self.depth -= 1
                    if self.depth == 0:
                        self.in_target = False
                elif tag == "tr" and self.depth == 1:
                    if self._cur_row:
                        if not self._header_done:
                            self._header_done = True  # skip header row
                        else:
                            self.rows.append(self._cur_row)
                    self._cur_row = []
                elif tag in ("td", "th") and self.depth == 1:
                    self._cur_row.append("".join(self._cur_cell).strip())
                    self._in_cell = False
                    self._cur_cell = []

            def handle_data(self, data):
                if self._in_cell:
                    self._cur_cell.append(data)

            def handle_entityref(self, name):
                if self._in_cell:
                    import html as _html
                    self._cur_cell.append(_html.unescape(f"&{name};"))

            def handle_charref(self, name):
                if self._in_cell:
                    import html as _html
                    self._cur_cell.append(_html.unescape(f"&#{name};"))

        p = TableParser(table_id)
        p.feed(html)
        return p.rows

    # ── curr_rank lookup ───────────────────────────────────────────────────────

    async def _lookup_curr_rank(self, player_name: str) -> Optional[int]:
        """Fetch jsplayers/curr_rank_atp.js and look up the player by name."""
        if self._curr_rank_cache is None:
            try:
                async with AsyncSession(impersonate="chrome120") as client:
                    r = await client.get(self.CURR_RANK_URL, timeout=15)
                    if r.status_code == 200:
                        m = re.search(r"var\s+currRank\s*=\s*(\{[\s\S]*?\});", r.text)
                        if m:
                            import json as _json
                            self._curr_rank_cache = _json.loads(m.group(1))
                        else:
                            self._curr_rank_cache = {}
                    else:
                        self._curr_rank_cache = {}
            except Exception as e:
                print(f"   ⚠  curr_rank fetch failed: {e}")
                self._curr_rank_cache = {}

        cache = self._curr_rank_cache or {}
        # Exact match first
        if player_name in cache:
            return int(cache[player_name])
        # Case-insensitive partial match (any word in player_name must appear in key)
        name_lower = player_name.lower()
        for key, val in cache.items():
            if key.lower() == name_lower:
                return int(val)
        # Try matching on last surname part (e.g. "Jarry Fillol" in "Diego Jarry Fillol")
        parts = player_name.split()
        if len(parts) >= 2:
            last_two = " ".join(parts[-2:]).lower()
            for key, val in cache.items():
                if last_two in key.lower():
                    return int(val)
        return None

    # ── match history builder ──────────────────────────────────────────────────

    def _build_match_history(self, rows: list[list[str]]) -> list[dict]:
        """
        Convert recent-results table rows into grouped tournament match history.

        Row format (from debug):
        [date, tournament, surface, round, player_rank, opp_rank, score_desc, DR, ...]
        date: "11-May-2026"
        score_desc: "Ryan Colby [USA] d. Melnic" or "Melnic d. Maxwell Mckennon [USA]"
        round: "R32", "QF", etc.

        Groups consecutive rows for the same tournament+date into one tournament entry.
        Singles only: score format is "6-4 7-5" (not "10-5" tiebreaks from doubles).
        """
        if not rows:
            return []

        def parse_ta_date(s: str) -> Optional[str]:
            """'11-May-2026' → '2026-05-11'"""
            try:
                return datetime.strptime(s.strip(), "%d-%b-%Y").strftime("%Y-%m-%d")
            except Exception:
                return normalise_date(s)

        def player_won(score_desc: str, player_ref: str) -> bool:
            """Determine if the player (referenced by last-name part) won the match."""
            # score_desc: "Opponent [CC] d. Player" (loss) or "Player d. Opponent [CC]" (win)
            # "d." separates winner from loser
            if " d. " not in score_desc:
                return False
            winner_part = score_desc.split(" d. ")[0].strip()
            # Check if our player name appears in the winner part
            p_lower = player_ref.lower()
            return p_lower in winner_part.lower()

        def extract_opponent(score_desc: str, player_ref: str) -> str:
            """Extract opponent name and ranking from score_desc cell."""
            if " d. " not in score_desc:
                return score_desc.strip()
            parts = score_desc.split(" d. ")
            winner, loser = parts[0].strip(), parts[1].strip()
            p_lower = player_ref.lower()
            if p_lower in winner.lower():
                return loser  # player won; opponent is the loser
            return winner  # player lost; opponent is the winner

        def extract_score(cells: list[str]) -> str:
            """Score is in cell index 7 (the 8th cell, after score_desc)."""
            if len(cells) > 7:
                return cells[7].strip()
            return ""

        def sets_won_from_score(score: str) -> tuple[int, int]:
            """Parse '6-4 6-3' → (2, 0). Returns (player_sets, opp_sets)."""
            player_sets, opp_sets = 0, 0
            for part in score.split():
                m = re.match(r"^(\d+)-(\d+)", part)
                if m:
                    a, b = int(m.group(1)), int(m.group(2))
                    if a > b:
                        player_sets += 1
                    elif b > a:
                        opp_sets += 1
            return player_sets, opp_sets

        def is_qualifying_round(rnd: str) -> bool:
            """Q1, Q2, Q3 are qualifying rounds; exclude from main-draw stats."""
            return len(rnd) == 2 and rnd[0] == "Q" and rnd[1].isdigit()

        # Determine player reference: the name that appears in EVERY score_desc row.
        # In Tennis Abstract the format is always "Winner d. Loser [CC]" — our player
        # appears on alternating sides (winner when they win, loser when they lose).
        # We collect candidate tokens from all rows, strip country codes, then pick
        # the token that appears in the most rows — that's the player.
        player_ref = ""
        descs = [row[6] for row in rows if len(row) > 6 and " d. " in row[6]]
        if descs:
            from collections import Counter
            token_counts: Counter = Counter()
            for desc in descs:
                # Strip country codes like [USA], [CHI] etc.
                clean_desc = re.sub(r"\s*\[[A-Z]{2,3}\]", "", desc)
                # Each side of "d." is one player — collect each side as a candidate
                for side in clean_desc.split(" d. "):
                    token = side.strip()
                    if token:
                        token_counts[token] += 1
            # The player's name appears in every row (either side); opponents vary.
            # Pick the token with the highest count that is not a pure country string.
            for token, _ in token_counts.most_common():
                if token and not re.fullmatch(r"[A-Z]{2,3}", token):
                    player_ref = token
                    break

        # Group rows by (tournament, date) → collect all match rows per tournament
        from collections import OrderedDict
        tournaments_map: dict[str, dict] = OrderedDict()

        for row in rows:
            if len(row) < 7:
                continue

            date_raw = row[0]
            tourn    = row[1].strip()
            surf_raw = row[2].strip()
            rnd      = row[3].strip().upper()
            opp_rank_raw = row[5].strip() if len(row) > 5 else ""
            score_desc   = row[6].strip() if len(row) > 6 else ""
            score        = row[7].strip() if len(row) > 7 else ""

            # Skip doubles: doubles scores are like "10-5" (super-tiebreak)
            # Singles scores are always "X-Y" with X,Y <= 7 in each set
            if self._is_doubles_score(score):
                continue

            date_iso = parse_ta_date(date_raw)
            surface  = normalise_surface(surf_raw)

            key = f"{tourn}|{date_iso}"
            qualifying_first = is_qualifying_round(rnd)
            if key not in tournaments_map:
                initial_rnd = "" if qualifying_first else rnd
                tournaments_map[key] = {
                    "tournamentName":  tourn,
                    "date":            date_iso,
                    "surface":         surface,
                    "roundReached":    initial_rnd,
                    "wins":            0,
                    "losses":          0,
                    "pointsEarned":    self.calc_itf_points(self._infer_category(tourn), initial_rnd),
                    "rankingThatWeek": int(row[4]) if len(row) > 4 and row[4].isdigit() else None,
                    "matches":         [],
                }

            t = tournaments_map[key]
            qualifying = is_qualifying_round(rnd)

            # Determine win/loss from actual set scores, not from score_desc text
            ps, os_ = sets_won_from_score(score)
            won = ps > os_

            if not qualifying:
                if won:
                    t["wins"] += 1
                else:
                    t["losses"] += 1

                # Track best round reached (main draw only) and sync pointsEarned
                if rnd in self._ROUND_WINS:
                    cur_best = t.get("roundReached", "")
                    if self._ROUND_WINS.get(rnd, 0) > self._ROUND_WINS.get(cur_best, -1):
                        t["roundReached"] = rnd
                        # Points go to the round ADVANCED TO, not the round won in.
                        # A win at R32 → player reached R16 → award R16 points.
                        # A loss at R32 → player was eliminated at R32 → award R32 points.
                        pts_rnd = self._NEXT_ROUND.get(rnd, rnd) if won else rnd
                        cat = self._infer_category(tourn)
                        md_pts = self.calc_itf_points(cat, pts_rnd)
                        q_matches = [m for m in t["matches"] if m.get("qualifying")]
                        q_pts = self.calc_qualifying_points(cat, q_matches, rnd)
                        t["pointsEarned"] = md_pts + q_pts

            # Extract opponent — always append to matches (qualifying included for reference)
            opp_display = extract_opponent(score_desc, player_ref)
            opp_rank_str = f" ({opp_rank_raw})" if opp_rank_raw and opp_rank_raw.isdigit() else ""
            t["matches"].append({
                "round":       rnd,
                "opponent":    f"{opp_display}{opp_rank_str}".strip(),
                "score":       score,
                "qualifying":  qualifying,
            })

        return list(tournaments_map.values())

    # ── Points tables (official ATP/ITF values) ────────────────────────────────

    # Main draw points — earned only when advancing past a round (i.e. winning a match).
    # R32/R64 = 0 for M15/M25 because losing your first main-draw match earns nothing.
    _ITF_POINTS: dict[str, dict[str, int]] = {
        "M15":           {"W":15, "F":8,  "SF":4,  "QF":2,  "R16":1, "R32":0, "R64":0},
        "M25":           {"W":25, "F":14, "SF":7,  "QF":3,  "R16":1, "R32":0, "R64":0},
        "Challenger 50": {"W":50, "F":25, "SF":14, "QF":8,  "R16":4, "R32":3, "R64":1},
        "Challenger 75": {"W":75, "F":44, "SF":22, "QF":12, "R16":7, "R32":4, "R64":2},
        "Challenger 100":{"W":100,"F":50, "SF":25, "QF":16, "R16":7, "R32":4, "R64":2},
        "Challenger 125":{"W":125,"F":64, "SF":35, "QF":16, "R16":8, "R32":4, "R64":2},
        "Challenger 175":{"W":175,"F":90, "SF":50, "QF":25, "R16":13,"R32":6, "R64":3},
    }

    # Qualifying points (Challengers only; ITF qualifying = 0).
    # "qualifier" = won all qualifying rounds and entered main draw.
    # "last_round_loser" = won at least one qualifying match, lost in the final qualifying round.
    _QUALIFYING_POINTS: dict[str, dict[str, int]] = {
        "Challenger 50":  {"qualifier": 3, "last_round_loser": 1},
        "Challenger 75":  {"qualifier": 4, "last_round_loser": 2},
        "Challenger 100": {"qualifier": 4, "last_round_loser": 2},
        "Challenger 125": {"qualifier": 5, "last_round_loser": 3},
        "Challenger 175": {"qualifier": 6, "last_round_loser": 3},
    }

    # Per-name overrides for tournaments whose names don't include a tier number.
    # Keys are UPPERCASED tournament name substrings (matched via `in`).
    # Add entries here whenever a real-calendar cross-check confirms a tier.
    # Tournaments marked UNVERIFIED are NOT listed here — they fall through to the
    # generic CH default (Challenger 50) and are flagged explicitly in match_history.
    _CHALLENGER_TIER_OVERRIDES: dict[str, str] = {
        "TEMUCO":     "Challenger 100",  # confirmed CH100 (user-verified)
        "CARY":       "Challenger 75",   # confirmed CH75 (ITF listing)
        "SARASOTA":   "Challenger 75",   # confirmed CH75 (ITF listing)
        "PIRACICABA": "Challenger 75",   # confirmed CH75 (Perfect Tennis)
        # UNVERIFIED — fall to default CH50 until cross-checked:
        #   San Luis Potosi CH, Santa Cruz de la Sierra CH, Asuncion CIT CH
    }

    @staticmethod
    def _infer_category(name: str) -> Optional[str]:
        """Infer the ITF/Challenger category from a tournament name."""
        n = name.upper()
        if "M15" in n or "ITF15" in n: return "M15"
        if "M25" in n or "ITF25" in n: return "M25"
        # Check explicit tier numbers in name first
        for tier in ("175", "125", "100", "75", "50"):
            if f"CHALLENGER {tier}" in n or f"CH{tier}" in n or f"CH {tier}" in n:
                return f"Challenger {tier}"
            if re.search(rf"\bCH\s*{tier}\b", n):
                return f"Challenger {tier}"
        # Per-name override for ambiguous tournament names (cross-checked against ATP calendar)
        if "CHALLENGER" in n or re.search(r"\bCH\b", n):
            for key, tier in TennisAbstractScraper._CHALLENGER_TIER_OVERRIDES.items():
                if key in n:
                    return tier
            return "Challenger 50"  # default — unverified entries fall here
        return None

    def calc_itf_points(self, category: Optional[str], rnd: Optional[str]) -> int:
        """Main draw points for the deepest round reached."""
        if not category or not rnd:
            return 0
        return self._ITF_POINTS.get(category, {}).get((rnd or "").upper(), 0)

    def calc_qualifying_points(self, category: Optional[str],
                                qualifying_matches: list,
                                round_reached: str) -> int:
        """
        Qualifying points (Challengers only; ITF always 0).
        qualifying_matches: list of match dicts with qualifying=True.
        round_reached: the main-draw round reached (empty string if player didn't make the draw).
        """
        if not category or category not in self._QUALIFYING_POINTS:
            return 0
        # No qualifying matches stored → award 0 regardless of round_reached.
        # round_reached alone does not prove the player came through qualifying.
        if not qualifying_matches:
            return 0
        q_table = self._QUALIFYING_POINTS[category]
        if round_reached:
            # Qualifying matches exist AND player made the main draw → Qualifier
            return q_table["qualifier"]
        if not qualifying_matches:
            return 0
        # Player didn't make the main draw. Determine outcome from scores.
        q_round_order = {"Q1": 1, "Q2": 2, "Q3": 3, "Q4": 4}
        highest_loss_round = 0
        highest_win_round  = 0
        for m in qualifying_matches:
            rnd_key = m.get("round", "").upper()
            order   = q_round_order.get(rnd_key, 0)
            score   = m.get("score", "")
            ps, os_ = 0, 0
            for part in score.split():
                mx = re.match(r"^(\d+)-(\d+)", part)
                if mx:
                    a, b = int(mx.group(1)), int(mx.group(2))
                    if a > b: ps += 1
                    elif b > a: os_ += 1
            if ps > os_:
                highest_win_round = max(highest_win_round, order)
            else:
                highest_loss_round = max(highest_loss_round, order)
        if highest_loss_round == 0 and highest_win_round > 0:
            # All stored matches are wins but didn't make main draw — incomplete data.
            # Conservative: treat as last-round loser.
            return q_table["last_round_loser"]
        if highest_loss_round >= 2:
            # Lost at Q2 or later — Last Round Loser
            return q_table["last_round_loser"]
        # Lost at Q1 — earlier loss = 0
        return 0

    def _is_doubles_score(self, score: str) -> bool:
        """Return True if score looks like a doubles super-tiebreak (e.g. '10-5')."""
        if not score:
            return False
        # Super-tiebreak: one or both sets have a score > 7 (e.g. 10-5, 10-3)
        set_scores = score.split()
        for s in set_scores:
            m = re.match(r"^(\d+)-(\d+)", s)
            if m:
                a, b = int(m.group(1)), int(m.group(2))
                if a > 7 or b > 7:
                    return True
        return False

    # ── ranking evolution ──────────────────────────────────────────────────────

    def _parse_year_end_rankings(self, rows: list[list[str]]) -> list[dict]:
        """
        Parse year-end-rankings table rows.
        Row format: [year_label, atp_rank, points, elo_rank, elo, ...]
        year_label: "Current (2026-06-29)", "2025", "2024", ...
        """
        evolution = []
        for row in rows:
            if len(row) < 2:
                continue
            year_label = row[0].strip()
            rank_str   = row[1].strip()
            if not rank_str.isdigit():
                continue
            ranking = int(rank_str)
            # Parse date: "Current (2026-06-29)" → "2026-06-29", "2025" → "2025-12-31"
            date_m = re.search(r"(\d{4}-\d{2}-\d{2})", year_label)
            if date_m:
                date_str = date_m.group(1)
            else:
                year_m = re.search(r"(\d{4})", year_label)
                if year_m:
                    date_str = f"{year_m.group(1)}-12-31"
                else:
                    continue
            if 1 <= ranking <= 5000:
                evolution.append({"date": date_str, "ranking": ranking})
        return evolution

    # ── win/loss and defending points ──────────────────────────────────────────

    def _calc_win_loss(self, matches: list[dict]) -> dict:
        result = {
            "clay":  {"wins": 0, "losses": 0},
            "hard":  {"wins": 0, "losses": 0},
            "grass": {"wins": 0, "losses": 0},
        }
        for m in matches:
            surface = m.get("surface", "hard") if m.get("surface") in result else "hard"
            result[surface]["wins"]   += m.get("wins", 0)
            result[surface]["losses"] += m.get("losses", 0)
        tw = sum(v["wins"] for v in result.values() if isinstance(v, dict))
        tl = sum(v["losses"] for v in result.values() if isinstance(v, dict))
        result["total"] = {"wins": tw, "losses": tl}
        return result

    def _calc_defending_points(self, matches: list[dict]) -> list[dict]:
        """
        Maps each match's points to the equivalent week ONE YEAR LATER (52 weeks).
        Only uses matches from the previous calendar year.
        """
        defending: dict[str, dict] = {}
        current_year = datetime.now().year
        prev_year = current_year - 1
        for m in matches:
            date   = m.get("date")
            points = m.get("pointsEarned") or 0
            if not date or not points:
                continue
            try:
                dt = datetime.strptime(date, "%Y-%m-%d")
            except ValueError:
                continue
            if dt.year != prev_year:
                continue
            defending_dt = dt + timedelta(weeks=52)
            monday = (defending_dt - timedelta(days=defending_dt.weekday())).strftime("%Y-%m-%d")
            if monday not in defending:
                defending[monday] = {"weekOf": monday, "points": 0, "tournamentName": m.get("tournamentName") or ""}
            defending[monday]["points"] += points
        return sorted(defending.values(), key=lambda x: x["weekOf"])


# ── Supabase Integrator ────────────────────────────────────────────────────────

class TourlyDataIntegrator:

    def __init__(self):
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_KEY")
        if not url or not key:
            raise EnvironmentError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.")
        self.sb: Client = create_client(url, key)
        self._stats = {"found": 0, "added": 0, "updated": 0}

    def upsert_tournament(self, data: dict) -> str:
        itf_id = data.get("itf_id") or ""
        if itf_id:
            existing = self.sb.table("itf_tournaments").select("id").eq("itf_id", itf_id).execute()
        else:
            existing = self.sb.table("itf_tournaments").select("id").eq("name", data["name"]).eq("start_date", data["start_date"]).execute()

        if not data.get("start_date"):
            return "skipped"

        if existing.data:
            updates = {k: v for k, v in data.items() if v is not None}
            self.sb.table("itf_tournaments").update(updates).eq("id", existing.data[0]["id"]).execute()
            return "updated"
        else:
            self.sb.table("itf_tournaments").insert(data).execute()
            return "added"

    def sync_tournaments(self, tournaments: list[dict]):
        self._stats["found"] = len(tournaments)
        for t in tournaments:
            action = self.upsert_tournament(t)
            if action == "added":
                self._stats["added"] += 1
            elif action == "updated":
                self._stats["updated"] += 1
        print(f"✓  Tournaments synced — {self._stats['found']} found, {self._stats['added']} added, {self._stats['updated']} updated.")

    def upsert_player_profile(self, data: dict):
        try:
            player_name = data["player_name"]
            new_mh = data.get("match_history") or []

            # Guard: if new scrape returned empty match_history, preserve existing data
            if not new_mh:
                existing = self.sb.table("player_profiles") \
                    .select("match_history") \
                    .eq("player_name", player_name) \
                    .maybe_single() \
                    .execute()
                existing_mh = (existing.data or {}).get("match_history") or []
                if existing_mh:
                    print(f"⚠  Scrape returned empty match_history for '{player_name}' — preserving existing {len(existing_mh)} entries.")
                    data = {k: v for k, v in data.items() if k != "match_history"}

            self.sb.table("player_profiles").upsert(data, on_conflict="player_name").execute()
            print(f"✓  Player profile synced for '{player_name}'.")
        except Exception as e:
            print(f"⚠  Could not save player profile: {e}")

    def log_run(self, status: str, error: Optional[str] = None):
        try:
            self.sb.table("scraper_runs").insert({
                "ran_at":              datetime.now(timezone.utc).isoformat(),
                "tournaments_found":   self._stats["found"],
                "tournaments_added":   self._stats["added"],
                "tournaments_updated": self._stats["updated"],
                "status":              status,
                "error_message":       error,
            }).execute()
            print(f"📝  Run logged: {status}")
        except Exception as e:
            print(f"⚠  Could not write to scraper_runs (check API key permissions): {e}")


# ── Phase runners ──────────────────────────────────────────────────────────────

async def run_tournament_phase(integrator: TourlyDataIntegrator):
    scraper     = ITFTournamentScraper()
    tournaments = await scraper.scrape_calendar()
    integrator.sync_tournaments(tournaments)


async def run_challenger_phase(integrator: TourlyDataIntegrator):
    """Phase 1b — ATP Challenger calendar, stored in the same itf_tournaments table."""
    scraper     = ATPChallengerScraper()
    tournaments = await scraper.scrape_calendar()
    integrator.sync_tournaments(tournaments)


async def run_player_phase(integrator: TourlyDataIntegrator, player_name: str):
    scraper = TennisAbstractScraper()
    profile = await scraper.scrape_player(player_name, store_name=player_name)
    await asyncio.sleep(6)  # polite rate limit between players

    if profile:
        integrator.upsert_player_profile(profile)
    else:
        print(f"⚠  No data returned for '{player_name}' — profile not saved.")


# ── Entry point ────────────────────────────────────────────────────────────────

async def fetch_players_to_scrape(supabase: Client) -> list[str]:
    """
    Returns all player names to scrape, in priority order:
    1. player_profiles.player_name — already-scraped profiles (keep them fresh)
    2. profiles.atp_player_name   — app users who don't yet have a scraped profile
    """
    names: list[str] = []

    # Source 1: existing scraped profiles
    try:
        res = supabase.table("player_profiles").select("player_name").execute()
        for row in res.data or []:
            n = (row.get("player_name") or "").strip()
            if n:
                names.append(n)
    except Exception as e:
        print(f"   ⚠  Could not fetch from player_profiles: {e}")

    # Source 2: app users with atp_player_name not already covered
    try:
        res2 = supabase.from_("profiles").select("atp_player_name").neq("atp_player_name", None).execute()
        existing_lower = {n.lower() for n in names}
        for row in res2.data or []:
            n = (row.get("atp_player_name") or "").strip()
            if n and n.lower() not in existing_lower:
                names.append(n)
                existing_lower.add(n.lower())
    except Exception as e:
        print(f"   ⚠  Could not fetch from profiles: {e}")

    unique = list(dict.fromkeys(names))
    print(f"   Found {len(unique)} player(s) to scrape: {unique}")
    return unique


async def main():
    print("=" * 52)
    print("  TOURLY SCRAPER — SYNC ENGINE")
    print("=" * 52)

    try:
        integrator = TourlyDataIntegrator()
    except EnvironmentError as e:
        print(f"❌  {e}")
        return

    status    = "success"
    error_msg = None

    print("\n> Phase 1: ITF Tournament Calendar (M15/M25)")
    try:
        await run_tournament_phase(integrator)
    except Exception as e:
        status    = "failed"
        error_msg = f"Tournament scraper: {e}"
        print(f"✗  {error_msg}")

    print("\n> Phase 1b: ATP Challenger Calendar")
    try:
        await run_challenger_phase(integrator)
    except Exception as e:
        print(f"✗  Challenger scraper: {e}")
        if status == "success":
            status = "partial"

    player_name = os.getenv("PLAYER_NAME", "").strip()

    # Prefer explicit PLAYER_NAME env var; fall back to all names in profiles table
    if player_name:
        profile_players = [player_name]
    else:
        print("\n> Phase 2: Player Profiles — reading from profiles table")
        profile_players = await fetch_players_to_scrape(integrator.sb)

    if profile_players:
        for pname in profile_players:
            print(f"\n> Phase 2: Player Profile — {pname}")
            try:
                await run_player_phase(integrator, pname)
            except Exception as e:
                print(f"✗  Player scraper ({pname}): {e}")
                if status == "success":
                    status = "partial"
    else:
        print("\nℹ  No player names found — skipping player profile phase.")
        print("   Set atp_player_name in the app profile to enable this.")

    integrator.log_run(status=status, error=error_msg)
    print("\n✅  Scraper run complete.\n")


if __name__ == "__main__":
    asyncio.run(main())
