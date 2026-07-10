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
import random
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
from pydantic import BaseModel, ConfigDict, ValidationError
from supabase import create_client, Client

import itf_results

load_dotenv()

# Credentials come exclusively from the environment (.env locally, GitHub
# Secrets in CI). The service-role key bypasses RLS — it must never appear
# in source or in any tracked file.
if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_SERVICE_KEY"):
    sys.exit(
        "Missing SUPABASE_URL / SUPABASE_SERVICE_KEY. "
        "Copy scraper/.env.example to scraper/.env and fill in real values."
    )
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


# ── External payload schemas (pydantic) ─────────────────────────────────────────
#
# These model the MINIMAL contract each source actually delivers, matching exactly
# what the parsing code below reads (see field-by-field usage in each class).
# Fields already treated as optional/absent-tolerant in the code stay Optional
# here too — the goal is to catch a genuine shape change in the source (renamed
# field, wrong type, list-vs-dict swap), not to reject cosmetically-different but
# still-parseable payloads.

class SofascoreItfItem(BaseModel):
    """One item from the Sofascore ITF calendar API response's `items` array.
    Only fields read by ITFTournamentScraper._fetch_itf_via_browser are modelled.
    """
    model_config = ConfigDict(extra="ignore")

    tournamentKey: Optional[str] = None
    id: Optional[object] = None  # fallback id — not consistently a fixed type
    tournamentName: Optional[str] = None
    name: Optional[str] = None
    venue: Optional[str] = None
    location: Optional[str] = None
    hostNation: Optional[str] = None
    surfaceDesc: Optional[str] = None
    surfaceCode: Optional[str] = None
    category: Optional[str] = None
    startDate: Optional[str] = None
    endDate: Optional[str] = None
    prizeMoney: Optional[object] = None  # source sends this as string or number


class AtpChallengerItem(BaseModel):
    """One tournament item from the ATP Challenger calendar JSON API
    (TournamentDates[].Tournaments[]). Only fields read by
    ATPChallengerScraper.scrape_calendar are modelled.
    """
    model_config = ConfigDict(extra="ignore")

    Id: Optional[object] = None
    Name: Optional[str] = None
    Location: Optional[str] = None
    Surface: Optional[str] = None
    Type: Optional[str] = None
    TotalFinancialCommitment: Optional[object] = None
    PrizeMoneyDetails: Optional[object] = None
    FormattedDate: Optional[str] = None


class TennisAbstractMatchRow(BaseModel):
    """
    The Tennis Abstract 'recent-results' table row shape consumed by
    TennisAbstractScraper._build_match_history. Rows arrive as list[str] from
    the HTML table parser; only cells actually read are modelled here
    (indices 0-7: date, tournament, surface, round, player_rank, opp_rank,
    score_desc, score — see _build_match_history's column-index comment).
    Cells beyond index 7 are tolerated (ignored) since the parser never reads
    them.
    """
    model_config = ConfigDict(extra="ignore")

    date: str
    tournament: str
    surface: str
    round: str
    player_rank: Optional[str] = ""
    opp_rank: Optional[str] = ""
    score_desc: Optional[str] = ""
    score: Optional[str] = ""

    @classmethod
    def from_row(cls, row: list) -> "TennisAbstractMatchRow":
        """Build from the positional list[str] row format; missing trailing
        cells (row shorter than 8) map to their Optional defaults."""
        cells = list(row) + [None] * (8 - len(row))
        return cls(
            date=cells[0] or "",
            tournament=cells[1] or "",
            surface=cells[2] or "",
            round=cells[3] or "",
            player_rank=cells[4] or "",
            opp_rank=cells[5] or "",
            score_desc=cells[6] or "",
            score=cells[7] or "",
        )


def validate_batch(raw_items: list, model: type[BaseModel], phase: str) -> tuple[list, int]:
    """
    Validate a batch of raw dict/list items against a pydantic model at the
    ingestion boundary.

    Returns (valid_raw_items, invalid_count) — valid_raw_items are the ORIGINAL
    raw items (not the parsed model instances), so downstream code keeps
    operating on the raw dict/list shape it already expects; validation here is
    purely a shape-change tripwire, not a replacement for existing parsing.

    Logs the first 3 validation failures per phase (then suppresses further
    per-item logging to avoid flooding output on a systemic shape change).
    """
    valid: list = []
    invalid_count = 0
    logged = 0
    for item in raw_items:
        try:
            if isinstance(item, list):
                model.from_row(item)  # type: ignore[attr-defined]
            else:
                model.model_validate(item)
            valid.append(item)
        except ValidationError as e:
            invalid_count += 1
            if logged < 3:
                print(f"⚠  [{phase}] schema validation failed for item: {e.errors()[0] if e.errors() else e}")
                logged += 1
    if invalid_count > 3:
        print(f"⚠  [{phase}] ...and {invalid_count - 3} more validation failure(s) suppressed.")
    return valid, invalid_count


# ── Tournament Scraper (ITF via direct HTTP) ───────────────────────────────────

class ITFTournamentScraper:
    """
    Fetches the ITF Men's World Tennis Tour calendar from Sofascore's public API.
    Uses scheduled-events by date to collect all tennis tournaments day-by-day,
    then filters for ITF and Challenger events.
    """

    ITF_KEYWORDS = ("itf", "challenger", "world tennis tour", "m15", "m25", "m60", "m80", "m100")

    def __init__(self):
        # Set by _fetch_itf_via_browser after schema validation so the caller
        # (run_tournament_phase) can decide whether the phase should be treated
        # as FAILED due to a source shape change (see validate_batch/>50% rule).
        self.last_valid_count: int = 0
        self.last_invalid_count: int = 0

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

        # Schema-validate each raw item at the ingestion boundary before parsing.
        # Invalid items are counted and dropped; run_tournament_phase uses the
        # invalid/total ratio to decide if the source's shape changed (>50% ⇒ FAILED).
        valid_items, invalid_count = validate_batch(captured_items, SofascoreItfItem, "itf_calendar")
        self.last_valid_count = len(valid_items)
        self.last_invalid_count = invalid_count

        # Deduplicate by tournamentKey and normalise
        seen: set[str] = set()
        tournaments = []
        for item in valid_items:
            tid = item.get("tournamentKey") or item.get("id") or ""
            tid = str(tid)
            if not tid or tid in seen:
                continue
            seen.add(tid)
            surface_raw = item.get("surfaceDesc") or item.get("surfaceCode") or ""
            start_date = normalise_date(item.get("startDate"))
            tournaments.append({
                "itf_id":            tid,
                "name":              item.get("tournamentName") or item.get("name") or "",
                "city":              item.get("venue") or item.get("location"),
                "country":           item.get("hostNation"),
                "surface":           normalise_surface(surface_raw),
                "category":          item.get("category"),
                "start_date":        start_date,
                "end_date":          normalise_date(item.get("endDate")),
                "prize_money_total": parse_prize(item.get("prizeMoney")),
                "season":            int(start_date[:4]) if start_date else None,
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
                                "season":            year,
                                "is_auto_populated": True,
                            })

        except Exception as e:
            print(f"   ⚠  Wikipedia fetch failed: {e}")

        return tournaments


# ── ATP Challenger Scraper ────────────────────────────────────────────────────

class ATPChallengerScraper:
    """
    Fetches the ATP Challenger tournament calendar.

    Strategy: curl_cffi TLS impersonation against the ATP Sitecore internal API.
    - Warm up session on /en/tournaments (required for session cookie).
    - Call /en/-/tournaments/calendar/challenger which returns all Challenger
      tournaments for the current calendar year as JSON with Type="CH".

    Real API field names (confirmed live 2026-07):
      Id, Name, Location, FormattedDate, Surface, TotalFinancialCommitment,
      PrizeMoneyDetails, IndoorOutdoor, ChallengerCategory (always null — use prize)

    FormattedDate format: "5 - 10 January, 2026" or "29 December, 2025 - 4 January, 2026"
    ChallengerCategory is null for all entries; category is derived from prize money.

    IMPORTANT — TFC vs prize fund:
    The ATP calendar JSON only exposes `TotalFinancialCommitment` (TFC), which bundles
    on-site prize money together with hospitality/bonus-pool obligations the tournament
    owes ATP. TFC is NOT the prize fund shown to players (e.g. a Challenger 100 has a
    TFC around $160,680 but an actual prize fund of ~$80,000). Storing TFC directly in
    `prize_money_total` inflates the number the app displays to players.
    Fix: classify the tournament's Challenger tier from TFC (thresholds below map TFC
    ranges to tiers — these are wide enough to separate tiers even though TFC != prize
    fund), then look up the *official prize fund* for that tier from `_TIER_PRIZE_FUND`
    and store that instead. `category` continues to reflect the derived tier label.
    """

    def __init__(self):
        # Set by scrape_calendar after schema validation so the caller
        # (run_challenger_phase) can decide whether the phase should be treated
        # as FAILED due to a source shape change (see validate_batch/>50% rule).
        self.last_valid_count: int = 0
        self.last_invalid_count: int = 0

    _ATP_CH_API    = "https://www.atptour.com/en/-/tournaments/calendar/challenger"
    _ATP_WARMUP    = "https://www.atptour.com/en/tournaments"

    _H_HTML = {
        "User-Agent": HTTP_HEADERS["User-Agent"],
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    _H_JSON = {
        "User-Agent": HTTP_HEADERS["User-Agent"],
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://www.atptour.com/en/tournaments?tourCodes=CH",
    }

    # Thresholds on TotalFinancialCommitment (TFC) used ONLY to classify which
    # Challenger tier a tournament belongs to — TFC includes hospitality/bonus-pool
    # fees on top of prize money, so these thresholds are approximate boundaries
    # between tiers, not the prize fund itself. See _TIER_PRIZE_FUND for the actual
    # prize money to store.
    _PRIZE_TIERS = [
        (175_000, "Challenger 175"),
        (125_000, "Challenger 125"),
        (100_000, "Challenger 100"),
        (75_000,  "Challenger 75"),
        (50_000,  "Challenger 50"),
    ]

    # Official 2026 ATP Challenger Tour prize funds (on-site prize money) per
    # category tier — this is what gets stored in prize_money_total, NOT the TFC.
    # ASSUMPTION: atp-2026-rulebook.pdf §3.22 states Challenger prize money
    # "increase[s] annually by 2.5% per each tournament category" but does not
    # publish a base-figure table in extractable text on the page (verified by
    # reading pages 33-35 of the rulebook directly — the section is a one-line
    # policy statement, no dollar table). These figures are the task-provided
    # standard 2026 approximations; verify against the official ATP Challenger
    # Tour Regulations / Prize Money chart before relying on them for financial
    # reporting.
    _TIER_PRIZE_FUND = {
        "Challenger 50":  40_000,
        "Challenger 75":  60_000,
        "Challenger 100": 80_000,
        "Challenger 125": 120_000,
        "Challenger 175": 220_000,
    }

    # "5 - 10 January, 2026"  OR  "29 December, 2025 - 4 January, 2026"
    _DATE_RE = re.compile(
        r"(\d{1,2})\s+(\w+),?\s+(\d{4})"  # matches "D Month, YYYY" or "D Month YYYY"
    )
    _MONTHS = {m: i for i, m in enumerate(
        ["January","February","March","April","May","June",
         "July","August","September","October","November","December"], 1
    )}

    def _parse_formatted_date(self, formatted: str) -> tuple[Optional[str], Optional[str]]:
        """
        Parse "5 - 10 January, 2026" or "29 December, 2025 - 4 January, 2026"
        into (start_date, end_date) as "YYYY-MM-DD" strings.
        Returns (None, None) on failure.
        """
        if not formatted:
            return None, None
        parts = re.split(r"\s*-\s*", formatted.strip())
        dates = []
        for part in parts:
            m = self._DATE_RE.search(part)
            if m:
                day, mon_str, year = int(m.group(1)), m.group(2), int(m.group(3))
                mon = self._MONTHS.get(mon_str)
                if mon:
                    dates.append(f"{year:04d}-{mon:02d}-{day:02d}")
        # Single-month range like "5 - 10 January, 2026": first part has no month/year
        # so only one date parsed from the second part — find start day from left token
        if len(dates) == 1 and len(parts) == 2:
            left = parts[0].strip()
            day_m = re.match(r"^(\d{1,2})$", left)
            if day_m:
                # Same month/year as the single parsed date
                yyyy_mm = dates[0][:7]
                start = f"{yyyy_mm}-{int(day_m.group(1)):02d}"
                return start, dates[0]
        if len(dates) >= 2:
            return dates[0], dates[1]
        if len(dates) == 1:
            return dates[0], dates[0]
        return None, None

    def _normalise_category(self, prize_raw: str) -> str:
        prize = parse_prize(prize_raw)
        if prize is not None:
            for threshold, label in self._PRIZE_TIERS:
                if prize >= threshold:
                    return label
        return "Challenger 50"

    async def scrape_calendar(self) -> list[dict]:
        print("Fetching ATP Challenger calendar via curl_cffi...")
        async with AsyncSession(impersonate="chrome131") as client:
            # Warm up to get session cookie
            r0 = await client.get(self._ATP_WARMUP, headers=self._H_HTML, timeout=30)
            if r0.status_code != 200 or len(r0.content) < 10_000:
                print(f"   WARNING: warmup returned {r0.status_code}, {len(r0.content)} bytes — proceeding anyway")

            r = await client.get(self._ATP_CH_API, headers=self._H_JSON, timeout=30)
            if r.status_code != 200 or not r.content:
                print(f"   ERROR: challenger API returned {r.status_code}, {len(r.content)} bytes")
                return []

            body = r.json()
            raw_items = [t for dg in body.get("TournamentDates", []) for t in dg.get("Tournaments", [])]
            print(f"   Raw items from API: {len(raw_items)}")

        # Filter to Challenger-type items first (non-CH items, e.g. ATP Tour main
        # draw, are a different — legitimately-shaped — payload, not a validation
        # failure), then schema-validate the CH items at the ingestion boundary.
        ch_items = [t for t in raw_items if isinstance(t, dict) and t.get("Type") == "CH"]
        valid_items, invalid_count = validate_batch(ch_items, AtpChallengerItem, "challenger_calendar")
        self.last_valid_count = len(valid_items)
        self.last_invalid_count = invalid_count

        seen: set[str] = set()
        tournaments = []
        for item in valid_items:
            tid = str(item.get("Id") or "")
            if not tid:
                continue
            atp_id = f"atp_ch_{tid}"
            if atp_id in seen:
                continue
            seen.add(atp_id)

            name = (item.get("Name") or "").strip()
            location = (item.get("Location") or "").strip()
            # Location is "City, Country" — split on last comma
            if "," in location:
                city, country = location.rsplit(",", 1)
                city, country = city.strip(), country.strip()
            else:
                city, country = location, None

            surface    = normalise_surface(item.get("Surface") or "")
            tfc_raw    = str(item.get("TotalFinancialCommitment") or item.get("PrizeMoneyDetails") or "")
            category   = self._normalise_category(tfc_raw)
            # Store the derived official prize fund for the tier, NOT the raw TFC
            # (TFC includes hospitality/bonus-pool commitments — see class docstring).
            # Invariant: prize fund can never exceed TFC, so clamp — protects
            # against the tier table's approximations overshooting (seen on 175s).
            prize      = self._TIER_PRIZE_FUND.get(category)
            tfc_value  = parse_prize(tfc_raw)
            if prize is not None and tfc_value is not None:
                prize = min(prize, tfc_value)
            start_date, end_date = self._parse_formatted_date(item.get("FormattedDate") or "")

            if not name or not start_date:
                continue

            season = int(start_date[:4])

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
                "season":            season,
                "is_auto_populated": True,
            })

        print(f"   Normalised: {len(tournaments)} Challenger tournaments")
        return tournaments


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


    def __init__(self):
        self._curr_rank_cache: Optional[dict] = None
        # Set by _build_match_history after schema validation so the caller
        # (run_player_phase) can decide whether the phase should be treated as
        # FAILED due to a Tennis Abstract table shape change (see >50% rule).
        self.last_row_valid_count: int = 0
        self.last_row_invalid_count: int = 0

    # ── WAF-aware GET helper ──────────────────────────────────────────────────

    async def _ta_get(self, client, url: str, headers: dict, label: str):
        """GET with the TA WAF dance: one 429 wait-and-retry on the same session,
        one 403 retry on a fresh session with a different TLS fingerprint
        (TA's WAF keys on fingerprint + session, so retrying the blocked
        session rarely helps). Returns the final Response, or None if every
        attempt raised."""
        try:
            r = await client.get(url, headers=headers, timeout=20)
        except Exception as e:
            print(f"   ⚠  HTTP error for {label}: {e}")
            return None

        if r.status_code == 429:
            print(f"   ⚠  Rate limited — waiting 30s...")
            await asyncio.sleep(30)
            try:
                r = await client.get(url, headers=headers, timeout=20)
            except Exception as e:
                print(f"   ⚠  HTTP error for {label}: {e}")
                return None

        # 403s from Tennis Abstract have been observed to be intermittent
        # bot-detection rather than a hard per-IP block (a later slug/player
        # in the same run can succeed) — one retry with backoff before
        # giving up. The retry uses a FRESH session with a different TLS
        # fingerprint: TA's WAF keys on the fingerprint + session, so
        # retrying on the same blocked session rarely helps.
        if r.status_code == 403:
            print(f"   ⚠  {label}: HTTP 403 — retrying once with a fresh fingerprint after 20s...")
            await asyncio.sleep(20)
            try:
                async with AsyncSession(impersonate="chrome131") as retry_client:
                    r = await retry_client.get(url, headers=headers, timeout=20)
            except Exception as e:
                print(f"   ⚠  HTTP error for {label} on retry: {e}")
                return None

        return r

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
                # 403s from Tennis Abstract have been observed to be intermittent
                # bot-detection rather than a hard per-IP block (a later slug/player
                # in the same run can succeed) — _ta_get retries once with backoff
                # before giving up on this slug.
                r = await self._ta_get(client, url, headers, slug)
                if r is None:
                    continue

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
                rf = await self._ta_get(client, frag_url, headers, f"jsfrags {slug}")
                if rf is None:
                    print(f"   ⚠  jsfrags fetch error — no match history for {slug}")
                elif rf.status_code == 200:
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

        # Schema-validate each raw row at the ingestion boundary (observability only —
        # does NOT filter `rows` or alter any parsing/points/win-loss logic below,
        # which keeps its own tolerant length checks e.g. `len(row) < 7`). This exists
        # purely to catch a genuine Tennis Abstract table shape change (column
        # reordering/removal) via invalid_count, surfaced by the caller's >50% gate.
        valid_rows, invalid_row_count = validate_batch(rows, TennisAbstractMatchRow, "player_match_rows")
        if invalid_row_count:
            print(f"⚠  [player_match_rows] {invalid_row_count}/{len(rows)} row(s) failed schema validation.")
        self.last_row_valid_count = len(valid_rows)
        self.last_row_invalid_count = invalid_row_count

        def parse_ta_date(s: str) -> Optional[str]:
            """'11-May-2026' → '2026-05-11'"""
            try:
                return datetime.strptime(s.strip(), "%d-%b-%Y").strftime("%Y-%m-%d")
            except Exception:
                return normalise_date(s)

        _PREFIX_RE = re.compile(r"^\([^)]+\)\s*")

        def strip_entry_prefix(s: str) -> str:
            """Remove entry-type prefixes like (WC), (Q), (LL), (5), (Alt), (JE)."""
            return _PREFIX_RE.sub("", s).strip()

        def player_won(score_desc: str, player_ref: str) -> Optional[bool]:
            """
            Return True (won), False (lost), or None (cannot match — do not guess).

            Tennis Abstract uses "Winner d. Loser [CC]" format.  Entry-type prefixes
            like (WC), (Q), (LL), (5) are stripped before comparing so that a player
            who appears as "(WC)Zapp" in some rows and "Zapp" in others is matched
            correctly in both cases.

            None is returned when:
              - score_desc uses " vs " (incomplete/pending result)
              - " d. " is missing for any other reason
              - the player's clean name cannot be found in either the winner or loser slot
            """
            if " d. " not in score_desc:
                return None  # " vs " or unparseable — no result to read
            # Strip country codes then split
            clean = re.sub(r"\s*\[[A-Z]{2,3}\]", "", score_desc)
            winner_raw, loser_raw = clean.split(" d. ", 1)
            winner_clean = strip_entry_prefix(winner_raw).lower()
            loser_clean  = strip_entry_prefix(loser_raw).lower()
            p = strip_entry_prefix(player_ref).lower()
            # Substring match in both directions: handles abbreviated/partial names
            in_winner = bool(p) and (p in winner_clean or winner_clean in p)
            in_loser  = bool(p) and (p in loser_clean  or loser_clean  in p)
            if in_winner and not in_loser:
                return True
            if in_loser and not in_winner:
                return False
            return None  # ambiguous or not found — do not guess

        def extract_opponent(score_desc: str, player_ref: str) -> str:
            """Extract opponent name from score_desc cell."""
            if " d. " not in score_desc:
                return score_desc.strip()
            parts = score_desc.split(" d. ", 1)
            winner_raw, loser_raw = parts[0].strip(), parts[1].strip()
            p = strip_entry_prefix(player_ref).lower()
            winner_clean = strip_entry_prefix(winner_raw).lower()
            in_winner = bool(p) and (p in winner_clean or winner_clean in p)
            if in_winner:
                return loser_raw   # player won; opponent is the loser
            return winner_raw      # player lost (or unknown); opponent is the winner

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

        # Determine player reference: the clean name that appears in every score_desc row.
        # Entry-type prefixes like (WC), (Q), (LL), (5) are stripped before counting so
        # the same player listed as "(WC)Zapp", "(Q)Zapp", or "Zapp" always accumulates
        # to the same token "Zapp" — not split across three competing tokens.
        player_ref = ""
        descs = [row[6] for row in rows if len(row) > 6 and " d. " in row[6]]
        if descs:
            from collections import Counter
            token_counts: Counter = Counter()
            for desc in descs:
                # Strip country codes like [USA], [CHI] etc.
                clean_desc = re.sub(r"\s*\[[A-Z]{2,3}\]", "", desc)
                # Each side of "d." is one player — collect entry-prefix-stripped tokens
                for side in clean_desc.split(" d. "):
                    token = strip_entry_prefix(side.strip())
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
            # Determine win/loss BEFORE creating the entry so initial_rnd can
            # respect the confirmed-result requirement.  Rows are processed in
            # reverse-chronological order, so the first row seen for a tournament
            # is often the deepest (main-draw) round.
            won_pre = player_won(score_desc, player_ref) if not qualifying_first else None
            if key not in tournaments_map:
                if qualifying_first:
                    initial_rnd = ""
                elif won_pre is not None:
                    initial_rnd = rnd           # confirmed result → set round
                else:
                    initial_rnd = "unconfirmed" # no result recorded
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

            # Determine win/loss from score_desc ("Winner d. Loser") name position.
            # Returns True/False/None — None means the player's name could not be
            # matched to either slot (name variant or unparseable format).
            won = player_won(score_desc, player_ref)

            if not qualifying:
                if won is True:
                    t["wins"] += 1
                elif won is False:
                    t["losses"] += 1
                # won is None → name_match_failed; do not guess wins or losses

                # Track best round reached (main draw only) and sync pointsEarned
                if rnd in self._ROUND_WINS:
                    cur_best = t.get("roundReached", "")
                    if won is not None:
                        # Confirmed result (win or loss) — advance roundReached normally.
                        # "unconfirmed" sentinel has _ROUND_WINS value -1, so any real
                        # confirmed round always supersedes it.
                        if self._ROUND_WINS.get(rnd, 0) > self._ROUND_WINS.get(cur_best, -1):
                            t["roundReached"] = rnd
                            cat = self._infer_category(tourn)
                            md_pts = self.calc_itf_points(cat, rnd)
                            q_matches = [m for m in t["matches"] if m.get("qualifying")]
                            q_pts = self.calc_qualifying_points(cat, q_matches, rnd)
                            t["pointsEarned"] = md_pts + q_pts
                    elif cur_best in ("", "unconfirmed"):
                        # No result recorded (playerWon=None). Mark as unconfirmed so
                        # display code knows this round was attempted but not resolved.
                        # "unconfirmed" is truthy → calc_qualifying_points treats the
                        # player as a qualifier if qualifying matches are present.
                        # "unconfirmed" is NOT in _ITF_POINTS → main draw pts = 0.
                        t["roundReached"] = "unconfirmed"

            # Extract opponent — always append to matches (qualifying included for reference)
            opp_display = extract_opponent(score_desc, player_ref)
            opp_rank_str = f" ({opp_rank_raw})" if opp_rank_raw and opp_rank_raw.isdigit() else ""
            match_entry: dict = {
                "round":      rnd,
                "opponent":   f"{opp_display}{opp_rank_str}".strip(),
                "score":      score,
                "playerWon":  won,      # True / False / None (None = name_match_failed)
                "qualifying": qualifying,
            }
            if won is None:
                match_entry["name_match_failed"] = True
            t["matches"].append(match_entry)

        # Final pass: recalculate pointsEarned for every entry using its COMPLETE
        # match list.  Tennis Abstract delivers rows in reverse-chronological order,
        # so qualifying rounds (Q1, Q2, …) are appended AFTER the main-draw round
        # that already called calc_qualifying_points with an empty q_matches list.
        # Reading the full list here produces the correct qualifying-points total.
        for entry in tournaments_map.values():
            rnd = entry.get("roundReached", "")
            cat = self._infer_category(entry.get("tournamentName", ""))
            q_matches = [m for m in entry["matches"] if m.get("qualifying")]
            entry["pointsEarned"] = (
                self.calc_itf_points(cat, rnd)
                + self.calc_qualifying_points(cat, q_matches, rnd)
            )

        return list(tournaments_map.values())

    # ── Points tables (official ATP/ITF values) ────────────────────────────────

    # Main draw points — earned only when advancing past a round (i.e. winning a match).
    # R32/R64 = 0 for ALL categories: losing your first main-draw match earns nothing.
    # Source: ATP Official Rulebook Section 9.04, Singles Point Table.
    _ITF_POINTS: dict[str, dict[str, int]] = {
        "M15":           {"W":15,  "F":8,  "SF":4,  "QF":2,  "R16":1, "R32":0, "R64":0},
        "M25":           {"W":25,  "F":14, "SF":7,  "QF":3,  "R16":1, "R32":0, "R64":0},
        "Challenger 50": {"W":50,  "F":25, "SF":14, "QF":8,  "R16":4, "R32":0, "R64":0},
        "Challenger 75": {"W":75,  "F":44, "SF":22, "QF":12, "R16":6, "R32":0, "R64":0},
        "Challenger 100":{"W":100, "F":50, "SF":25, "QF":14, "R16":7, "R32":0, "R64":0},
        "Challenger 125":{"W":125, "F":64, "SF":35, "QF":16, "R16":8, "R32":0, "R64":0},
        "Challenger 175":{"W":175, "F":90, "SF":50, "QF":25, "R16":13,"R32":0, "R64":0},
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
        # Kept for backwards-compat / quick inspection; per-run figures now live in
        # scraper_runs rows (see start_run/finish_run) rather than this cumulative dict.
        self._stats = {"found": 0, "added": 0, "updated": 0}

    def upsert_tournament(self, data: dict) -> str:
        """
        Upsert a single tournament row. Upserts are keyed by itf_id (or name+start_date
        as a fallback) and only ever INSERT or UPDATE the matched row — there is no
        delete/purge path here, so past-season rows already in the table are never
        touched by an unrelated scrape and are retained indefinitely.
        """
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

    def sync_tournaments(self, tournaments: list[dict]) -> dict:
        """Upsert all tournaments and return this call's own found/added/updated counts."""
        stats = {"found": len(tournaments), "added": 0, "updated": 0, "skipped": 0}
        for t in tournaments:
            action = self.upsert_tournament(t)
            if action in stats:
                stats[action] += 1
        # Keep cumulative _stats in sync too (informational only)
        self._stats["found"]   += stats["found"]
        self._stats["added"]   += stats["added"]
        self._stats["updated"] += stats["updated"]
        print(f"✓  Tournaments synced — {stats['found']} found, {stats['added']} added, {stats['updated']} updated.")
        return stats

    @staticmethod
    def _match_history_key(match_history: list) -> set:
        """
        Build a comparable, order-insensitive fingerprint of a match_history list:
        one entry per (tournament, date) with its round/points/win-loss and the
        set of individual matches — so a scrape that returns the same tournaments
        and matches (possibly in a different order) is recognised as unchanged.
        """
        fingerprint = set()
        for entry in match_history or []:
            matches_fp = tuple(sorted(
                (m.get("round"), m.get("opponent"), m.get("score"), m.get("playerWon"), m.get("qualifying"))
                for m in (entry.get("matches") or [])
            ))
            fingerprint.add((
                entry.get("tournamentName"),
                entry.get("date"),
                entry.get("roundReached"),
                entry.get("wins"),
                entry.get("losses"),
                entry.get("pointsEarned"),
                matches_fp,
            ))
        return fingerprint

    def upsert_player_profile(self, data: dict) -> str:
        """
        Upsert a player profile. Returns one of:
          "written"   — row was inserted/updated
          "unchanged" — new match_history is identical to the stored one; write skipped
          "error"     — upsert failed (see printed warning)
        """
        try:
            player_name = data["player_name"]
            new_mh = data.get("match_history") or []

            existing = self.sb.table("player_profiles") \
                .select("match_history") \
                .eq("player_name", player_name) \
                .maybe_single() \
                .execute()
            # maybe_single().execute() returns None (not a response with .data=None)
            # when no row matches — i.e. every brand-new player, like this one.
            existing_mh = ((existing.data if existing else None) or {}).get("match_history") or []

            # Guard: if new scrape returned empty match_history, preserve existing data
            if not new_mh:
                if existing_mh:
                    print(f"⚠  Scrape returned empty match_history for '{player_name}' — preserving existing {len(existing_mh)} entries.")
                    data = {k: v for k, v in data.items() if k not in ("match_history", "points_defending", "win_loss_by_surface")}

            # Incremental-aware: if the freshly scraped match_history is identical
            # (same tournaments + matches) to what's already stored, skip the write
            # entirely to avoid pointless updated_at churn on unchanged data.
            elif existing_mh and self._match_history_key(new_mh) == self._match_history_key(existing_mh):
                print(f"=  match_history unchanged for '{player_name}' ({len(new_mh)} tournaments) — skipping write.")
                return "unchanged"

            self.sb.table("player_profiles").upsert(data, on_conflict="player_name").execute()
            print(f"✓  Player profile synced for '{player_name}'.")
            return "written"
        except Exception as e:
            print(f"⚠  Could not save player profile: {e}")
            return "error"

    # ── scraper_runs logging (liveness / observability) ──────────────────────
    #
    # scraper_runs schema (confirmed live):
    #   id identity, phase text, status text in 'ok'|'low_rows'|'error',
    #   rows_found int, rows_upserted int, error text,
    #   started_at timestamptz default now(), finished_at timestamptz
    #
    # Each phase calls start_run() at the beginning and finish_run() at the end
    # (success or failure) so a stalled/crashed phase still leaves a row with
    # started_at set and finished_at null — visible as a stuck run.

    def start_run(self, phase: str) -> Optional[int]:
        try:
            res = self.sb.table("scraper_runs").insert({
                "phase":      phase,
                "status":     "ok",
                "started_at": datetime.now(timezone.utc).isoformat(),
            }).execute()
            run_id = (res.data or [{}])[0].get("id")
            print(f"📝  scraper_runs: started phase='{phase}' id={run_id}")
            return run_id
        except Exception as e:
            print(f"⚠  Could not create scraper_runs row for phase '{phase}': {e}")
            return None

    def finish_run(self, run_id: Optional[int], *, status: str,
                    rows_found: int = 0, rows_upserted: int = 0,
                    error: Optional[str] = None):
        if run_id is None:
            return
        try:
            self.sb.table("scraper_runs").update({
                "status":        status,
                "rows_found":    rows_found,
                "rows_upserted": rows_upserted,
                "error":         error,
                "finished_at":   datetime.now(timezone.utc).isoformat(),
            }).eq("id", run_id).execute()
            print(f"📝  scraper_runs: finished id={run_id} status={status} "
                  f"found={rows_found} upserted={rows_upserted}")
        except Exception as e:
            print(f"⚠  Could not update scraper_runs id={run_id}: {e}")


# ── Phase runners ──────────────────────────────────────────────────────────────
#
# Liveness gate thresholds — chosen to match how each phase actually scopes its
# fetch (read the scraper classes above for the exact windows):
#   - ITF phase (_fetch_itf_via_browser) walks 12 forward months of the full
#     calendar every run — a full-season-shaped fetch — so it should reliably
#     return well over 30 tournaments; anything less signals the API/browser
#     path silently broke (Incapsula block, layout change, etc).
#   - Challenger phase hits /tournaments/calendar/challenger, which returns the
#     ENTIRE current ATP Challenger season (not an incremental window) — same
#     full-season threshold applies.
# Both phases are full-calendar fetches, not incremental weekly windows, so the
# lower "≥8 incremental" threshold from the task brief does not apply to either;
# it's kept here for phases that might later scope to a short window.
GATE_FULL_SEASON_MIN_ROWS  = 30
GATE_INCREMENTAL_MIN_ROWS  = 8

# Schema-validation "source changed shape" gate: if more than this fraction of a
# phase's raw items fail pydantic validation, the source's payload shape has
# likely changed (renamed/removed/retyped field) rather than just containing a
# few malformed records — treat the phase as FAILED (status 'error', nonzero exit).
SCHEMA_INVALID_RATIO_FAIL = 0.5


def _schema_failure_reason(valid_count: int, invalid_count: int) -> Optional[str]:
    """
    Returns an error message if >50% of a phase's items failed schema validation
    (the "source changed shape" signal), else None. <=50% invalid is tolerated —
    the caller should still proceed with the valid items and may note
    invalid_count informationally.
    """
    total = valid_count + invalid_count
    if total == 0 or invalid_count == 0:
        return None
    ratio = invalid_count / total
    if ratio > SCHEMA_INVALID_RATIO_FAIL:
        return (f"schema validation failed for {invalid_count}/{total} "
                f"({ratio:.0%}) items — source shape likely changed")
    return None


async def run_tournament_phase(integrator: TourlyDataIntegrator) -> bool:
    """Returns True if the phase's liveness gate passed (rows_found >= threshold)."""
    run_id = integrator.start_run("itf_calendar")
    try:
        scraper     = ITFTournamentScraper()
        tournaments = await scraper.scrape_calendar()
        stats       = integrator.sync_tournaments(tournaments)
        rows_found  = stats["found"]
        rows_upsert = stats["added"] + stats["updated"]

        schema_error = _schema_failure_reason(scraper.last_valid_count, scraper.last_invalid_count)
        if schema_error:
            print(f"❌  SCHEMA FAILURE: ITF calendar — {schema_error}")
            integrator.finish_run(run_id, status="error", rows_found=rows_found,
                                   rows_upserted=rows_upsert, error=schema_error)
            return False

        gate_ok     = rows_found >= GATE_FULL_SEASON_MIN_ROWS
        status      = "ok" if gate_ok else "low_rows"
        error_note  = (f"invalid_count={scraper.last_invalid_count} (informational; "
                        f"<={SCHEMA_INVALID_RATIO_FAIL:.0%} threshold)") if scraper.last_invalid_count else None
        if not gate_ok:
            print(f"⚠  LOW ROWS: ITF calendar returned {rows_found} "
                  f"(< {GATE_FULL_SEASON_MIN_ROWS} threshold)")
        integrator.finish_run(run_id, status=status, rows_found=rows_found,
                               rows_upserted=rows_upsert, error=error_note)
        return gate_ok
    except Exception as e:
        integrator.finish_run(run_id, status="error", error=str(e))
        raise


async def run_challenger_phase(integrator: TourlyDataIntegrator) -> bool:
    """Phase 1b — ATP Challenger calendar, stored in the same itf_tournaments table."""
    run_id = integrator.start_run("challenger_calendar")
    try:
        scraper     = ATPChallengerScraper()
        tournaments = await scraper.scrape_calendar()
        stats       = integrator.sync_tournaments(tournaments)
        rows_found  = stats["found"]
        rows_upsert = stats["added"] + stats["updated"]

        schema_error = _schema_failure_reason(scraper.last_valid_count, scraper.last_invalid_count)
        if schema_error:
            print(f"❌  SCHEMA FAILURE: Challenger calendar — {schema_error}")
            integrator.finish_run(run_id, status="error", rows_found=rows_found,
                                   rows_upserted=rows_upsert, error=schema_error)
            return False

        gate_ok     = rows_found >= GATE_FULL_SEASON_MIN_ROWS
        status      = "ok" if gate_ok else "low_rows"
        error_note  = (f"invalid_count={scraper.last_invalid_count} (informational; "
                        f"<={SCHEMA_INVALID_RATIO_FAIL:.0%} threshold)") if scraper.last_invalid_count else None
        if not gate_ok:
            print(f"⚠  LOW ROWS: Challenger calendar returned {rows_found} "
                  f"(< {GATE_FULL_SEASON_MIN_ROWS} threshold)")
        integrator.finish_run(run_id, status=status, rows_found=rows_found,
                               rows_upserted=rows_upsert, error=error_note)
        return gate_ok
    except Exception as e:
        integrator.finish_run(run_id, status="error", error=str(e))
        raise


async def run_player_phase(integrator: TourlyDataIntegrator, player_name: str) -> bool:
    """
    Returns True if the phase's liveness gate passed. Reuses the existing
    empty-match-history guard in upsert_player_profile (which preserves existing
    data instead of overwriting with an empty scrape) — here we additionally
    record that outcome as a 'low_rows' scraper_runs entry so it's visible
    alongside the calendar phases rather than only as a console warning.
    """
    run_id  = integrator.start_run(f"player:{player_name}")
    try:
        scraper = TennisAbstractScraper()
        profile = await scraper.scrape_player(player_name, store_name=player_name)
        await asyncio.sleep(6)  # polite rate limit between players

        if profile:
            schema_error = _schema_failure_reason(scraper.last_row_valid_count, scraper.last_row_invalid_count)
            if schema_error:
                print(f"❌  SCHEMA FAILURE: '{player_name}' Tennis Abstract rows — {schema_error}")
                integrator.finish_run(run_id, status="error",
                                       rows_found=len(profile.get("match_history") or []),
                                       rows_upserted=0, error=schema_error)
                return False

            match_count   = len(profile.get("match_history") or [])
            write_status  = integrator.upsert_player_profile(profile)
            gate_ok       = match_count > 0
            # rows_upserted reflects what actually changed in storage: 0 when the
            # scrape matched what's already stored (incremental no-op), otherwise
            # the full match_count for a real write. A failed write still reports
            # the liveness gate honestly but leaves rows_upserted at 0.
            rows_upserted = match_count if write_status == "written" else 0
            status        = "ok" if gate_ok else "low_rows"
            error_note    = (f"invalid_count={scraper.last_row_invalid_count} (informational; "
                              f"<={SCHEMA_INVALID_RATIO_FAIL:.0%} threshold)") if scraper.last_row_invalid_count else None

            # Best-effort cross-check against an independent second results source
            # (Sofascore). Read-only/flag-only by design — never mutates profile or
            # match_history; any failure here degrades to "xcheck: unavailable" and
            # never affects the phase's own status/gate.
            xcheck_note = "xcheck: unavailable"
            try:
                alt_results = await itf_results.fetch_player_results(player_name)
                discrepancies = itf_results.cross_check(profile.get("match_history") or [], alt_results)
                xcheck_note = itf_results.summarise(discrepancies) if alt_results is not None else "xcheck: unavailable"
                high = [d for d in discrepancies if d.severity == "HIGH"]
                if high:
                    print(f"🚨  CROSS-CHECK: {len(high)} HIGH discrepancy(ies) for '{player_name}':")
                    for d in high:
                        print(f"    {d}")
            except Exception as e:
                print(f"⚠  Cross-check skipped for '{player_name}': {e}")
                xcheck_note = "xcheck: skipped (error)"

            error_note = f"{error_note}; {xcheck_note}" if error_note else xcheck_note

            if not gate_ok:
                print(f"⚠  LOW ROWS: '{player_name}' scrape returned empty "
                      f"match_history — existing data preserved (see guard above).")
            integrator.finish_run(run_id, status=status, rows_found=match_count,
                                   rows_upserted=rows_upserted, error=error_note)
            return gate_ok
        else:
            print(f"⚠  No data returned for '{player_name}' — profile not saved.")
            integrator.finish_run(run_id, status="low_rows", rows_found=0, rows_upserted=0)
            return False
    except Exception as e:
        integrator.finish_run(run_id, status="error", error=str(e))
        raise


# ── Entry point ────────────────────────────────────────────────────────────────

# atp_player_name values that are app/store test accounts, not real tennis
# players — scraping them just burns a Tennis Abstract request every run for a
# guaranteed 403/no-match, tripping the liveness gate for no reason.
NON_PLAYER_NAMES = {"reviewer ios", "reviewer", "test", "test account"}


def _norm_player_name(name: str) -> str:
    """
    Normalise a player name for NON_PLAYER_NAMES comparison: NFKC-fold unicode
    (turns non-breaking/narrow spaces into plain spaces), collapse internal
    whitespace runs, lowercase. A DB value like "Reviewer iOS " must match
    the plain-ascii blocklist entry "reviewer ios".
    """
    import unicodedata
    folded = unicodedata.normalize("NFKC", name or "")
    return " ".join(folded.split()).lower()

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
            if n and _norm_player_name(n) not in NON_PLAYER_NAMES:
                names.append(n)
    except Exception as e:
        print(f"   ⚠  Could not fetch from player_profiles: {e}")

    # Source 2: app users with atp_player_name not already covered
    try:
        res2 = supabase.from_("profiles").select("atp_player_name").neq("atp_player_name", None).execute()
        existing_norm = {_norm_player_name(n) for n in names}
        for row in res2.data or []:
            n = (row.get("atp_player_name") or "").strip()
            norm = _norm_player_name(n)
            if n and norm not in existing_norm and norm not in NON_PLAYER_NAMES:
                names.append(n)
                existing_norm.add(norm)
    except Exception as e:
        print(f"   ⚠  Could not fetch from profiles: {e}")

    unique = list(dict.fromkeys(names))
    print(f"   Found {len(unique)} player(s) to scrape: {unique}")
    return unique


async def main(*, players_only: bool = False) -> int:
    """
    Runs all phases unconditionally (a gate failure or exception in one phase
    does not skip the others), then exits nonzero if ANY phase failed or tripped
    its liveness gate — so GitHub Actions goes red and the run is investigated,
    even though every phase that could still run, did.

    players_only: skip both calendar phases (ITF + Challenger) and run only the
    player profile phase. Used by the daily incremental-results workflow, which
    runs more often than the full weekly calendar sync. Logging/gates for the
    phases that do run are unchanged.
    """
    print("=" * 52)
    print("  TOURLY SCRAPER — SYNC ENGINE" + ("  (--players-only)" if players_only else ""))
    print("=" * 52)

    try:
        integrator = TourlyDataIntegrator()
    except EnvironmentError as e:
        print(f"❌  {e}")
        return 1

    any_failure = False

    if players_only:
        print("\nℹ  --players-only: skipping ITF and Challenger calendar phases.")
    else:
        print("\n> Phase 1: ITF Tournament Calendar (M15/M25)")
        try:
            ok = await run_tournament_phase(integrator)
            any_failure = any_failure or not ok
        except Exception as e:
            print(f"✗  Tournament scraper: {e}")
            any_failure = True

        print("\n> Phase 1b: ATP Challenger Calendar")
        try:
            ok = await run_challenger_phase(integrator)
            any_failure = any_failure or not ok
        except Exception as e:
            print(f"✗  Challenger scraper: {e}")
            any_failure = True

    player_name = os.getenv("PLAYER_NAME", "").strip()

    # Prefer explicit PLAYER_NAME env var; fall back to all names in profiles table
    if player_name:
        profile_players = [player_name]
    else:
        print("\n> Phase 2: Player Profiles — reading from profiles table")
        profile_players = await fetch_players_to_scrape(integrator.sb)

    if profile_players:
        # A single player's gate tripping (e.g. Tennis Abstract 403ing that one
        # slug) doesn't fail the whole run — the empty-match-history guard
        # already preserves that player's existing data, so nothing was lost.
        # Only fail the phase if EVERY player came back empty, which signals a
        # systemic break (TA layout change, blanket IP block) rather than
        # one-off per-player flakiness.
        player_results: list[bool] = []
        for i, pname in enumerate(profile_players):
            if i > 0:
                # Space out TA requests between players so the WAF is less
                # likely to flag the run.
                await asyncio.sleep(random.uniform(8, 15))
            print(f"\n> Phase 2: Player Profile — {pname}")
            try:
                ok = await run_player_phase(integrator, pname)
                player_results.append(ok)
            except Exception as e:
                print(f"✗  Player scraper ({pname}): {e}")
                player_results.append(False)
        if player_results and not any(player_results):
            print(f"\n❌  ALL {len(player_results)} player(s) failed their liveness gate — "
                  f"treating as a systemic failure (not just per-player flakiness).")
            any_failure = True
    else:
        print("\nℹ  No player names found — skipping player profile phase.")
        print("   Set atp_player_name in the app profile to enable this.")

    if any_failure:
        print("\n❌  Scraper run complete WITH FAILURES/LOW-ROW GATES — exiting nonzero.\n")
        return 1

    print("\n✅  Scraper run complete.\n")
    return 0


def fix_prizes(integrator: TourlyDataIntegrator, dry_run: bool = True) -> int:
    """
    One-off repair for the TFC-vs-prize-fund bug: re-derives prize_money_total
    for existing Challenger rows in itf_tournaments using the tier already
    stored in `category` (e.g. "Challenger 100") mapped through
    ATPChallengerScraper._TIER_PRIZE_FUND.

    Only touches rows whose category starts with "Challenger " — ITF rows
    (M15/M25) are untouched since their prize_money_total was never TFC-based.

    NOT run automatically anywhere — invoke explicitly with:
        python tourly_scraper.py --fix-prizes            # dry run, prints diffs
        python tourly_scraper.py --fix-prizes --apply     # writes changes
    Returns the number of rows that were (or would be) updated.
    """
    tier_fund = ATPChallengerScraper._TIER_PRIZE_FUND
    res = integrator.sb.table("itf_tournaments") \
        .select("id,name,category,prize_money_total") \
        .like("category", "Challenger %") \
        .execute()
    rows = res.data or []
    changed = 0
    for row in rows:
        category = row.get("category")
        correct_prize = tier_fund.get(category)
        if correct_prize is None:
            continue
        current_prize = row.get("prize_money_total")
        # Invariant: prize fund <= TFC. The stored value is TFC (that's the bug),
        # so never "correct" upward — if the tier table exceeds the stored TFC,
        # the TFC is the better bound and the row is left alone (seen on 175s).
        if current_prize is not None and correct_prize > current_prize:
            continue
        if current_prize == correct_prize:
            continue
        changed += 1
        action = "WOULD UPDATE" if dry_run else "UPDATING"
        print(f"{action}  id={row['id']} name={row.get('name')!r} "
              f"category={category} prize_money_total: {current_prize} -> {correct_prize}")
        if not dry_run:
            integrator.sb.table("itf_tournaments") \
                .update({"prize_money_total": correct_prize}) \
                .eq("id", row["id"]) \
                .execute()
    print(f"\n{'Would change' if dry_run else 'Changed'} {changed} of {len(rows)} Challenger rows.")
    return changed


if __name__ == "__main__":
    if "--fix-prizes" in sys.argv:
        apply_changes = "--apply" in sys.argv
        _integrator = TourlyDataIntegrator()
        fix_prizes(_integrator, dry_run=not apply_changes)
        sys.exit(0)
    _players_only = "--players-only" in sys.argv
    sys.exit(asyncio.run(main(players_only=_players_only)))
