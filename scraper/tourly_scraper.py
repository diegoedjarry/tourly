"""
Tourly ITF/ATP Scraper
----------------------
P1 — Tournament calendar:  ITF via direct HTTP (daily at 06:00 UTC)
P2 — Player profile:       ATP website by player name (weekly on Monday)

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
from playwright.async_api import async_playwright, Page
from playwright_stealth import Stealth
from supabase import create_client, Client

load_dotenv()

# ── Hardcoded for testing — swap SUPABASE_SERVICE_KEY to secret key before prod ─
os.environ.setdefault("SUPABASE_URL", "https://bpxcizhgntucuhhyykqc.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJweGNpemhnbnR1Y3VoaHl5a3FjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTYzODg0OCwiZXhwIjoyMDk3MjE0ODQ4fQ.nzpHZ4kS4K16CqlomrAxURVWcuhFQtU9l324r7XuEiM")
os.environ.setdefault("PLAYER_NAME", "")

# ── Constants ──────────────────────────────────────────────────────────────────

ITF_CALENDAR_URL = "https://www.itftennis.com/en/tournament-calendar/mens-world-tennis-tour/"
ITF_API_URL      = "https://www.itftennis.com/tennis/api/TournamentApi/GetCalendar"
ATP_SEARCH_URL   = "https://www.atptour.com/en/search/player-results"
ATP_PLAYER_BASE  = "https://www.atptour.com/en/players"

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


# ── Player Scraper (ATP website) ───────────────────────────────────────────────

class ATPPlayerScraper:
    """
    Searches the ATP Tour website by player name and scrapes their public profile:
    ranking, match history (last 52 weeks), win/loss by surface, ranking evolution.
    """

    def __init__(self, page: Page):
        self.page = page

    async def scrape_player(self, player_name: str, store_name: Optional[str] = None) -> Optional[dict]:
        """
        store_name: the name to persist in player_profiles.player_name (defaults to player_name).
        Useful when the user registered as "Diego Jarry Fillol" but ATP lists them as "Diego Jarry".
        """
        print(f"\n📡  Searching ATP for player '{player_name}'...")

        # ── Step 1: search ATP autocomplete API ──────────────────────────────
        # Try each part of the name from last to first — handles Latin double surnames
        name_parts = player_name.split()
        profile_url = None
        for search_term in reversed(name_parts):
            profile_url = await self._find_profile_url(search_term, player_name)
            if profile_url:
                print(f"   ✓  Found via search term '{search_term}'")
                break

        if not profile_url:
            print(f"   ⚠  No ATP profile found for '{player_name}'.")
            return None

        print(f"   ✓  Profile URL: {profile_url}")

        # ── Step 2: navigate to overview ─────────────────────────────────────
        try:
            await self.page.goto(profile_url, wait_until="domcontentloaded", timeout=60_000)
        except Exception as e:
            print(f"   ⚠  Navigation warning: {e}")
        await self.page.wait_for_timeout(4_000)

        title = await self.page.title()
        print(f"   Page title: {title}")

        # Dump all text nodes that contain a number — helps find ranking location
        debug = await self.page.evaluate("""() => {
            const get = sel => { const el = document.querySelector(sel); return el ? el.textContent.trim() : null; };
            // Find elements whose text is a small number (likely ranking)
            const numbers = [...document.querySelectorAll('*')]
                .filter(el => el.children.length === 0 && /^\\d{1,4}$/.test(el.textContent.trim()))
                .slice(0, 10)
                .map(el => ({ tag: el.tagName, cls: el.className, text: el.textContent.trim() }));
            return {
                titleTag: document.title,
                numbers,
                bodySnippet: document.body.innerText.slice(0, 500),
            };
        }""")
        print(f"   Number elements: {debug.get('numbers')}")
        print(f"   Body snippet: {debug.get('bodySnippet', '')[:300]}")

        # Extract name from page title (most reliable — "Carlos Alcaraz | Overview | ATP Tour | Tennis")
        page_title   = debug.get("titleTag") or ""
        confirmed_name = page_title.split("|")[0].strip() if "|" in page_title else (
            debug.get("heroName") or debug.get("playerName") or debug.get("h1") or player_name
        )

        # Ranking is the first <strong> on the overview page (appears right after "Rank" label)
        current_ranking = await self.page.evaluate("""() => {
            const strongs = [...document.querySelectorAll('strong')];
            for (const s of strongs) {
                const t = s.textContent.trim();
                if (/^\\d{1,4}$/.test(t)) return parseInt(t);
            }
            return null;
        }""")
        print(f"   Name: {confirmed_name}  |  Ranking: {current_ranking}")

        # ── Step 3: player ID from URL for stats API ──────────────────────────
        player_id_match = re.search(r"/players/[^/]+/([A-Za-z0-9]+)/overview", profile_url)
        player_id       = player_id_match.group(1) if player_id_match else None
        print(f"   ATP player ID: {player_id}")

        match_history, total_wins, total_losses = await self._scrape_activity(profile_url)
        win_loss          = self._calc_win_loss(match_history, total_wins, total_losses)
        # Primary: ATP ranking points breakdown (exact defending data, 52-week window)
        # Fallback: calculated from match history if page returned nothing
        ranking_points    = await self._scrape_ranking_points(profile_url)
        points_defending  = ranking_points if ranking_points else self._calc_defending_points(match_history)
        ranking_evolution = await self._scrape_ranking_evolution(profile_url)

        return {
            "ipin":                player_id or player_name,
            # Use store_name (from profiles table) so the app ILIKE lookup always matches
            "player_name":         store_name or confirmed_name or player_name,
            "current_ranking":     current_ranking,
            "ranking_evolution":   ranking_evolution,
            "win_loss_by_surface": win_loss,
            "match_history":       match_history,
            "points_defending":    points_defending,
            "last_updated":        datetime.now(timezone.utc).isoformat(),
        }

    async def _find_profile_url(self, last_name: str, full_name: str) -> Optional[str]:
        """Use ATP autocomplete endpoint to get the player's profile URL."""
        try:
            async with AsyncSession(impersonate="chrome120") as client:
                r = await client.get(ATP_SEARCH_URL, params={"term": last_name}, headers=HTTP_HEADERS, timeout=15)
                print(f"   ATP search status: {r.status_code}")
                if r.status_code == 200:
                    data = r.json()
                    # ATP returns a list of {label, url, playerSlug, ...}
                    players = data if isinstance(data, list) else data.get("players") or data.get("results") or []
                    print(f"   ATP search results: {[p.get('label') or p.get('name') for p in players[:5]]}")
                    for p in players:
                        label = p.get("label") or p.get("name") or p.get("value") or ""
                        url   = p.get("url") or p.get("profileUrl") or p.get("href") or ""
                        if any(part.lower() in label.lower() for part in full_name.split()):
                            return url if url.startswith("http") else f"https://www.atptour.com{url}"
        except Exception as e:
            print(f"   ⚠  ATP search API failed: {e}")

        # Fallback: browser search on atptour.com
        url = await self._browser_search(full_name)
        if not url:
            # Last resort: try ATP rankings page which always lists ranked players
            url = await self._search_rankings_page(last_name)
        return url

    async def _browser_search(self, player_name: str) -> Optional[str]:
        """Use the ATP site search page to find a player profile URL."""
        name_parts = player_name.split()
        # Try each name part from last to first
        for search_term in reversed(name_parts):
            slug = search_term.lower().replace(" ", "-")
            search_url = f"https://www.atptour.com/en/search#q={search_term}&t=players"
            try:
                await self.page.goto(search_url, wait_until="domcontentloaded", timeout=60_000)
            except Exception as e:
                print(f"   ⚠  Browser nav warning: {e}")
            await self.page.wait_for_timeout(5_000)

            # Dismiss cookie banner
            try:
                await self.page.evaluate("""() => {
                    const btn = document.getElementById('onetrust-accept-btn-handler');
                    if (btn) btn.click();
                    const sdk = document.getElementById('onetrust-consent-sdk');
                    if (sdk) sdk.remove();
                }""")
                await self.page.wait_for_timeout(500)
            except Exception:
                pass

            all_hrefs = await self.page.evaluate("""() =>
                [...document.querySelectorAll('a[href*="/players/"]')]
                  .map(a => ({href: a.href, text: a.textContent.trim()}))
                  .filter(x => x.href.includes('/overview'))
            """)
            print(f"   Search '{search_term}': {len(all_hrefs)} player links")

            for item in all_hrefs:
                if slug in item.get("href", "").lower():
                    print(f"   ✓  Found via search slug '{slug}'")
                    return item["href"]
            for item in all_hrefs:
                if search_term.lower() in item.get("text", "").lower():
                    print(f"   ✓  Found via search text '{search_term}'")
                    return item["href"]

        return None

    async def _search_rankings_page(self, last_name: str) -> Optional[str]:
        """Paginate through ATP rankings in batches of 500 to find any ranked player."""
        last_slug = last_name.lower().replace(" ", "-")
        for start in range(1, 2500, 500):
            end = start + 499
            url = f"https://www.atptour.com/en/rankings/singles?rankRange={start}-{end}&perPageCount=500"
            try:
                await self.page.goto(url, wait_until="domcontentloaded", timeout=60_000)
                await self.page.wait_for_timeout(4_000)
                await self.page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await self.page.wait_for_timeout(1_500)
                links = await self.page.evaluate("""() =>
                    [...document.querySelectorAll('a[href*="/players/"]')]
                      .map(a => a.href).filter(h => h.includes('/overview'))
                """)
                print(f"   Rankings {start}-{end}: {len(links)} links")
                for href in links:
                    if last_slug in href.lower():
                        print(f"   ✓  Found via rankings {start}-{end}: {href}")
                        return href
                if len(links) < 10:
                    break  # no more players at this rank range
            except Exception as e:
                print(f"   ⚠  Rankings {start}-{end}: {e}")
        return None

    async def _scrape_activity(self, profile_url: str) -> tuple[list[dict], int, int]:
        """
        Fetch match history for the previous and current year.
        Returns (match_list, total_wins_current_year, total_losses_current_year).
        The ATP player-activity page is server-side rendered — all data is in the
        DOM innerText as structured tournament sections ending with "Points: X".
        """
        all_results: list[dict] = []
        current_year = datetime.now(timezone.utc).year
        wl_re = re.compile(r'Win/Loss\s*\n?\s*(\d+)\s*[-–]\s*(\d+)', re.IGNORECASE)
        total_wins = 0
        total_losses = 0

        for year in [current_year - 1, current_year]:
            url = profile_url.replace("/overview", "/player-activity") + f"?year={year}&surface=all"
            print(f"   Activity {year}: {url}")
            try:
                await self.page.goto(url, wait_until="domcontentloaded", timeout=60_000)
                await self.page.wait_for_timeout(6_000)
                await self.page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await self.page.wait_for_timeout(2_000)
            except Exception as e:
                print(f"   ⚠  Nav {year}: {e}")
                continue

            full_text = await self.page.evaluate("() => document.body.innerText")
            tournaments = self._parse_activity_text(full_text)
            print(f"   {year}: {len(tournaments)} tournaments parsed from DOM")
            all_results.extend(tournaments)

            if year == current_year:
                wl_m = wl_re.search(full_text)
                if wl_m:
                    total_wins   = int(wl_m.group(1))
                    total_losses = int(wl_m.group(2))
                    print(f"   W/L {year}: {total_wins}-{total_losses}")

        print(f"   Total tournaments scraped: {len(all_results)}")
        return all_results, total_wins, total_losses

    def _parse_activity_text(self, text: str) -> list[dict]:
        """
        Parse the player-activity page innerText into tournament records.
        Splits on "Points: X" (with optional trailing ATP Ranking / Prize Money).
        Captures all entries including 0-point R1 losses.
        """
        # Match "Points: X" with optional ", ATP Ranking: Y, Prize Money: Z" suffix
        pts_re  = re.compile(
            r'(?:Points:\s*([0-9\-–]+)(?:\s*,\s*ATP Ranking\s*[\d\-–]+)?(?:\s*,\s*Prize Money\s*[€$£]?[\d,.]+)?|Prize Money\s*[€$£]?[\d,.]+)',
            re.IGNORECASE
        )
        loc_re  = re.compile(
            r'^.+?,\s*.+?\s*\|\s*\d{1,2}\s+\w+,?\s*\d{2,4}\s*\|\s*.+$',
            re.MULTILINE
        )
        date_re = re.compile(r'\|\s*(\d{1,2}\s+\w+,?\s*\d{2,4})\s*\|')
        surf_re = re.compile(r'\|\s*(\w[\w\s()]*)\s*$')
        rnd_re  = re.compile(r'^(W|F|SF|QF|R\d{1,3}|RR)$', re.MULTILINE)

        SKIP_LINES = {
            "Activity", "Win/Loss", "Titles and Finals", "Player activity",
            "Singles", "Doubles", "Career", "Tourn(All)", "ATP Tour",
            "Overview", "Bio", "Stats", "Ranking",
        }

        chunks = pts_re.split(text)
        results = []

        for i in range(0, len(chunks) - 1, 2):
            section = chunks[i].strip()
            try:
                val = chunks[i + 1]
                pts_str = str(val).replace('-', '0').replace('–', '0').strip() if val else '0'
                pts = int(pts_str) if pts_str.isdigit() else 0
            except (IndexError, ValueError):
                continue
            # pts == 0 is valid (R1 loss) — only skip if we couldn't parse

            loc_match = loc_re.search(section)
            if not loc_match:
                continue

            loc_line = loc_match.group(0)
            date_m   = date_re.search(loc_line)
            surf_m   = surf_re.search(loc_line)
            date_str = normalise_date(date_m.group(1).strip()) if date_m else None
            surface  = normalise_surface(surf_m.group(1).strip()) if surf_m else "hard"

            # Tournament name = last meaningful line before the location line
            pre_lines = [l.strip() for l in section[:loc_match.start()].split('\n') if l.strip()]
            tournament_name = ""
            for line in reversed(pre_lines):
                if line and line not in SKIP_LINES and not re.fullmatch(r'\d{4}', line) \
                        and not re.fullmatch(r'[\d\s\-–W$€£,%.]+', line):
                    tournament_name = line
                    break

            if not tournament_name:
                continue

            post_loc   = section[loc_match.end():]
            rnd_match  = rnd_re.search(post_loc)
            best_round = rnd_match.group(1) if rnd_match else None
            rnd_key    = (best_round or "").upper().replace(" ", "")
            wins       = self._ROUND_WINS.get(rnd_key, 0)
            losses     = 0 if rnd_key == "W" else 1

            matches_list = []
            lines = [l.strip() for l in post_loc.replace('\t', '\n').split('\n') if l.strip()]
            for j, line in enumerate(lines):
                if re.fullmatch(r'^(W|F|SF|QF|R16|R32|R64|R128|RR)$', line, re.IGNORECASE):
                    # We found a match block. The next line is opponent.
                    if j + 1 < len(lines):
                        opponent = lines[j+1]
                        score = ""
                        for offset in (2, 3, 1):
                            if j + offset < len(lines):
                                cand = lines[j+offset]
                                if re.search(r'(RET|W/O|Default|Walkover)', cand, re.IGNORECASE) or \
                                   re.search(r'\d{2}\s+\d{2}', cand) or \
                                   re.search(r'\d-\d', cand) or \
                                   re.search(r'\d{2}\(', cand):
                                    score = cand
                                    break
                        
                        if score:
                            matches_list.append({
                                "round": line.upper(),
                                "opponent": opponent,
                                "score": score
                            })

            results.append({
                "tournamentName": tournament_name,
                "date":           date_str,
                "roundReached":   best_round,
                "pointsEarned":   pts,
                "surface":        surface,
                "wins":           wins,
                "losses":         losses,
                "matches":        matches_list,
            })

        return results

    async def _scrape_ranking_points(self, _profile_url: str) -> list[dict]:
        """
        Placeholder — the ATP rankings/breakdown page returns 404.
        points_defending is calculated from match history in _calc_defending_points instead.
        """
        return []

    async def _scrape_ranking_evolution(self, profile_url: str) -> list[dict]:
        evolution = []
        rankings_url = profile_url.replace("/overview", "/rankings-history")
        print(f"   Rankings URL: {rankings_url}")
        try:
            await self.page.goto(rankings_url, wait_until="domcontentloaded", timeout=60_000)
            await self.page.wait_for_timeout(6_000)
            await self.page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await self.page.wait_for_timeout(3_000)

            sample = await self.page.evaluate("""() => {
                const rows = [...document.querySelectorAll('tr')].slice(0, 3);
                return rows.map(r => r.innerText.trim().slice(0, 80));
            }""")
            print(f"   Ranking sample rows: {sample}")

            rows = await self.page.query_selector_all("tbody tr")
            for row in rows:
                try:
                    cells = await row.query_selector_all("td")
                    if len(cells) < 2:
                        continue
                    texts    = [(await c.inner_text()).strip() for c in cells]
                    date_str = normalise_date(texts[0])
                    ranking  = int(re.sub(r"\D", "", texts[1])) if re.search(r"\d", texts[1]) else None
                    if date_str and ranking:
                        evolution.append({"date": date_str, "ranking": ranking})
                except Exception:
                    continue
        except Exception as e:
            print(f"   ⚠  Rankings history failed: {e}")
        return evolution

    # Approximate wins based on round reached (assumes standard draw size)
    _ROUND_WINS = {"W": 6, "F": 5, "SF": 4, "QF": 3, "R16": 2, "R32": 1, "R64": 0, "R128": 0}

    def _calc_win_loss(self, matches: list[dict], total_wins: int = 0, total_losses: int = 0) -> dict:
        result = {
            "clay":  {"wins": 0, "losses": 0},
            "hard":  {"wins": 0, "losses": 0},
            "grass": {"wins": 0, "losses": 0},
        }
        for m in matches:
            surface = m.get("surface", "hard") if m.get("surface") in result else "hard"
            rnd = (m.get("roundReached") or "").upper().replace(" ", "")
            wins = self._ROUND_WINS.get(rnd, 0)
            # Each tournament = 1 loss (you always exit via a loss, unless you won the title)
            losses = 0 if rnd == "W" else 1
            result[surface]["wins"]   += wins
            result[surface]["losses"] += losses

        # Prefer page-scraped totals (more accurate); fall back to per-surface sum
        if total_wins or total_losses:
            result["total"] = {"wins": total_wins, "losses": total_losses}
        else:
            tw = sum(v["wins"] for v in result.values() if isinstance(v, dict) and "wins" in v)
            tl = sum(v["losses"] for v in result.values() if isinstance(v, dict) and "losses" in v)
            result["total"] = {"wins": tw, "losses": tl}
        return result

    def _calc_defending_points(self, matches: list[dict]) -> list[dict]:
        """
        Maps each match's points to the equivalent week ONE YEAR LATER (52 weeks).
        This tells the player when they need to defend points earned in the prior year.
        Only includes matches from the previous calendar year.
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
            # Only use results from the previous year (points expire after 52 weeks)
            if dt.year != prev_year:
                continue
            # Shift forward exactly 52 weeks so the defending week falls in current year
            defending_dt = dt + timedelta(weeks=52)
            monday = (defending_dt - timedelta(days=defending_dt.weekday())).strftime("%Y-%m-%d")
            if monday not in defending:
                defending[monday] = {"weekOf": monday, "points": 0, "tournamentName": m.get("tournamentName") or ""}
            defending[monday]["points"] += points
        return sorted(defending.values(), key=lambda x: x["weekOf"])

    async def _text(self, selector: str) -> Optional[str]:
        el = await self.page.query_selector(selector)
        return (await el.inner_text()).strip() if el else None


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
            self.sb.table("player_profiles").upsert(data, on_conflict="ipin").execute()
            print(f"✓  Player profile synced for '{data['player_name']}'.")
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


async def fetch_all_ranked_players() -> list[str]:
    """
    Scrapes the ATP singles rankings page and returns a list of all player names.
    Uses the ATP rankings JSON endpoint which returns all ranked players.
    """
    url = "https://www.atptour.com/en/rankings/singles"
    # ATP rankings JSON API — returns all players with their name and ranking
    json_url = "https://www.atptour.com/en/rankings/singles?rankRange=1-2000&region=all&surface=all&raceTo=0&inDecider=false&compareType=none&perPageCount=200&rankingTab=singles&format=json"
    headers = {**HTTP_HEADERS, "Accept": "application/json, text/javascript, */*; q=0.01",
               "X-Requested-With": "XMLHttpRequest", "Referer": url}
    names: list[str] = []
    try:
        async with AsyncSession(impersonate="chrome120") as client:
            for start in range(0, 2000, 200):
                paged = json_url.replace("rankRange=1-2000", f"rankRange={start+1}-{start+200}")
                r = await client.get(paged, headers=headers, timeout=20)
                if r.status_code != 200:
                    break
                data = r.json()
                players = (data.get("rankingPlayers") or data.get("players")
                           or data.get("data") or [])
                if not players:
                    break
                for p in players:
                    name = (p.get("playerName") or p.get("fullName")
                            or f"{p.get('firstName','')} {p.get('lastName','')}").strip()
                    if name:
                        names.append(name)
                if len(players) < 200:
                    break
    except Exception as e:
        print(f"   ⚠  Rankings fetch error: {e}")
    print(f"   Found {len(names)} ranked players from ATP rankings page.")
    return names


async def run_all_players_phase(integrator: TourlyDataIntegrator):
    """Scrapes every ranked ATP player and upserts their profile into Supabase."""
    print("\n> Phase 2b: All Ranked Players")
    player_names = await fetch_all_ranked_players()
    if not player_names:
        print("   ⚠  No players found — aborting all-players phase.")
        return

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, channel="chrome", args=BROWSER_ARGS)
        ctx = await browser.new_context(
            user_agent=HTTP_HEADERS["User-Agent"],
            viewport={"width": 1280, "height": 900},
            locale="en-US",
        )
        page = await ctx.new_page()
        await Stealth().apply_stealth_async(page)
        scraper = ATPPlayerScraper(page)
        try:
            for i, name in enumerate(player_names, 1):
                print(f"   [{i}/{len(player_names)}] Scraping {name}...")
                try:
                    profile = await scraper.scrape_player(name)
                    if profile:
                        integrator.upsert_player_profile(profile)
                        print(f"   ✓  {name} saved.")
                    else:
                        print(f"   ⚠  No data for {name}.")
                except Exception as e:
                    print(f"   ✗  {name} failed: {e}")
                # Polite delay between players to avoid getting blocked
                await asyncio.sleep(3)
        finally:
            await browser.close()


async def run_player_phase(integrator: TourlyDataIntegrator, player_name: str):
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True, channel="chrome", args=BROWSER_ARGS
        )
        ctx  = await browser.new_context(
            user_agent=HTTP_HEADERS["User-Agent"],
            viewport={"width": 1280, "height": 900},
            locale="en-US",
        )
        page = await ctx.new_page()
        await Stealth().apply_stealth_async(page)
        try:
            scraper = ATPPlayerScraper(page)
            profile = await scraper.scrape_player(player_name, store_name=player_name)
        finally:
            await browser.close()

    if profile:
        integrator.upsert_player_profile(profile)
    else:
        print(f"⚠  No data returned for '{player_name}' — profile not saved.")


# ── Entry point ────────────────────────────────────────────────────────────────

async def fetch_players_from_profiles(supabase: Client) -> list[str]:
    """Returns all distinct non-null atp_player_name values from the profiles table."""
    try:
        res = supabase.from_("profiles").select("atp_player_name").neq("atp_player_name", None).execute()
        names = [row["atp_player_name"].strip() for row in (res.data or []) if row.get("atp_player_name", "").strip()]
        unique = list(dict.fromkeys(names))
        print(f"   Found {len(unique)} ATP player(s) in profiles table: {unique}")
        return unique
    except Exception as e:
        print(f"   ⚠  Could not fetch players from profiles: {e}")
        return []


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

    print("\n> Phase 1: ITF Tournament Calendar")
    try:
        await run_tournament_phase(integrator)
    except Exception as e:
        status    = "failed"
        error_msg = f"Tournament scraper: {e}"
        print(f"✗  {error_msg}")

    all_players_mode = "--all-players" in sys.argv
    player_name = os.getenv("PLAYER_NAME", "").strip()

    if all_players_mode:
        try:
            await run_all_players_phase(integrator)
        except Exception as e:
            print(f"✗  All-players scraper: {e}")
            if status == "success":
                status = "partial"
    else:
        # Prefer explicit PLAYER_NAME env var; fall back to all names in profiles table
        if player_name:
            profile_players = [player_name]
        else:
            print("\n> Phase 2: Player Profiles — reading from profiles table")
            profile_players = await fetch_players_from_profiles(integrator.sb)

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
            print("\nℹ  No ATP player names found — skipping player profile phase.")
            print("   Set atp_player_name in the app profile to enable this.")

    integrator.log_run(status=status, error=error_msg)
    print("\n✅  Scraper run complete.\n")


if __name__ == "__main__":
    asyncio.run(main())
