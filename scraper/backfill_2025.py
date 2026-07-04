"""
Tourly 2025 Backfill
--------------------
Standalone, one-off script to backfill the 2025 season into itf_tournaments.

Production confirmed facts (2026-07 diagnosis):
  - itf_tournaments currently holds 540 rows spanning 2026-01-05 -> 2026-12-28 ONLY.
  - There is NO 2025 data in the table at all.
  - `season` (integer) now exists as a column and is backfilled for 2026 rows.
  - `is_auto_populated` is the existing flag used to mark scraper-written rows.

This script scrapes:
  1. The 2025 ITF Men's World Tennis Tour calendar from Wikipedia's quarterly
     season sub-pages — same wikitext-table parsing approach as
     ITFTournamentScraper._fetch_wikipedia() in tourly_scraper.py, just pointed
     at the 2025 sub-pages instead of the current year.
  2. The 2025 ATP Challenger Tour season page on Wikipedia (a single page
     listing the year's Challenger events, rather than ITF's quarterly split).

Both sources are normalised to the itf_tournaments schema with season=2025 and
is_auto_populated=true, then upserted using the same itf_id-keyed upsert logic
as the main scraper (insert-or-update by itf_id, or by name+start_date when no
stable id is available) — so re-running this script is safe/idempotent and it
will NEVER touch 2026+ rows.

SAFETY: --dry-run is the DEFAULT. Nothing is written to Supabase unless you
explicitly pass --apply. Dry run prints total counts per source plus 10 sample
rows so you can sanity-check the parse before writing anything.

Usage:
    python backfill_2025.py                 # dry run (default) — prints counts + samples
    python backfill_2025.py --dry-run       # same as above, explicit
    python backfill_2025.py --apply         # actually upserts into Supabase

Required env vars (same as tourly_scraper.py, loaded via .env):
    SUPABASE_URL
    SUPABASE_SERVICE_KEY
"""

import asyncio
import os
import re
import sys

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

from datetime import datetime
from typing import Optional

from curl_cffi.requests import AsyncSession
from dotenv import load_dotenv

load_dotenv()

SEASON = 2025

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


def normalise_surface(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    return SURFACE_MAP.get(raw.strip().lower())


# ── ITF Men's World Tennis Tour — 2025 (Wikipedia quarterly pages) ────────────
# Adapted directly from ITFTournamentScraper._fetch_wikipedia() in
# tourly_scraper.py, with `year` fixed to 2025 instead of the current year.

async def fetch_itf_2025() -> list[dict]:
    print("Fetching 2025 ITF Men's World Tennis Tour calendar from Wikipedia...")

    year = SEASON
    subpages = [
        f"{year}_ITF_Men%27s_World_Tennis_Tour_(January%E2%80%93March)",
        f"{year}_ITF_Men%27s_World_Tennis_Tour_(April%E2%80%93June)",
        f"{year}_ITF_Men%27s_World_Tennis_Tour_(July%E2%80%93September)",
        f"{year}_ITF_Men%27s_World_Tennis_Tour_(October%E2%80%93December)",
    ]
    tournaments: list[dict] = []
    seen: set[str] = set()

    date_cell_re = re.compile(r"(?:rowspan=\d+\|)?(\w+)\s+(\d{1,2})\s*$")
    tourn_cell_re = re.compile(
        r"\[\[([^\]]+)\]\],?\s*([^\n<]+)<br\s*/?>",
        re.IGNORECASE
    )
    surface_re = re.compile(r"\b(clay|hard|grass|carpet)\b", re.IGNORECASE)
    cat_re = re.compile(r"\b(M\d+|W\d+)\b")

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

                current_month = None
                current_day = None
                lines = wikitext.splitlines()

                for line in lines:
                    stripped = line.strip()

                    dm = date_cell_re.search(stripped.lstrip("|").strip())
                    if dm and stripped.startswith("|") and not stripped.startswith("|-"):
                        month_name = dm.group(1).lower()
                        if month_name in month_map:
                            current_month = month_map[month_name]
                            current_day = int(dm.group(2))
                            continue

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

                        city = city_raw.split("|")[-1]
                        country = re.sub(r"\[\[|\]\]", "", country_raw).strip(", ")

                        sm = surface_re.search(stripped)
                        surface = normalise_surface(sm.group(1)) if sm else None

                        cm = cat_re.search(stripped)
                        category = cm.group(1) if cm else "ITF Men's"

                        try:
                            start_date = datetime(year, current_month, current_day).strftime("%Y-%m-%d")
                        except ValueError:
                            continue

                        name = f"{city}, {country}" if country else city
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
        print(f"   Wikipedia fetch failed (ITF): {e}")

    print(f"   ITF 2025: {len(tournaments)} tournaments parsed.")
    return tournaments


# ── ATP Challenger Tour — 2025 (single Wikipedia season page) ────────────────
#
# Unlike the ITF calendar, the ATP Challenger Tour Wikipedia page lists the
# whole season's events as wikitable rows (Tournament | Date | City, Country |
# Surface | Category | ...) rather than a week-by-week grid, so this parser is
# simpler than the ITF one: walk wikitable rows and pick out the columns we
# need. The exact column layout varies by year/page revision, so parsing is
# best-effort and skips rows it cannot confidently read (never guesses).

_CH_CATEGORY_RE = re.compile(r"\bChallenger\s*(\d{2,3})\b", re.IGNORECASE)


async def fetch_atp_challenger_2025() -> list[dict]:
    print("Fetching 2025 ATP Challenger Tour calendar from Wikipedia...")

    page = f"{SEASON}_ATP_Challenger_Tour"
    tournaments: list[dict] = []
    seen: set[str] = set()

    try:
        async with AsyncSession(impersonate="chrome120") as client:
            url = (
                f"https://en.wikipedia.org/w/api.php?action=parse"
                f"&page={page}&prop=wikitext&format=json"
            )
            r = await client.get(url, timeout=20)
            if r.status_code != 200:
                print(f"   Page 404: {page}")
                return tournaments
            d = r.json()
            if "error" in d:
                print(f"   Page missing: {page}")
                return tournaments

            wikitext = d["parse"]["wikitext"]["*"]
            print(f"   Page len={len(wikitext)}: {page}")

            # Wikitable rows look like:
            #   |-
            #   | [[City]], [[Country]] || Jan 6 || Hard || $45,000 || ...
            # We scan cell-by-cell for a city/country wikilink pair, a date-like
            # token, and a surface keyword within the same row block.
            row_blocks = re.split(r"\n\|-", wikitext)

            surface_re = re.compile(r"\b(clay|hard|grass|carpet)\b", re.IGNORECASE)
            city_re = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\],?\s*\[\[([^\]|]+)(?:\|[^\]]+)?\]\]")
            date_re = re.compile(
                r"\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|"
                r"Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})",
                re.IGNORECASE,
            )
            month_abbrev = {
                "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
                "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
            }

            for block in row_blocks:
                city_m = city_re.search(block)
                date_m = date_re.search(block)
                if not city_m or not date_m:
                    continue

                city, country = city_m.group(1).strip(), city_m.group(2).strip()
                month_key = date_m.group(1)[:3].lower()
                month = month_abbrev.get(month_key)
                day = int(date_m.group(2))
                if not month:
                    continue
                try:
                    start_date = datetime(SEASON, month, day).strftime("%Y-%m-%d")
                except ValueError:
                    continue

                surf_m = surface_re.search(block)
                surface = normalise_surface(surf_m.group(1)) if surf_m else None

                cat_m = _CH_CATEGORY_RE.search(block)
                category = f"Challenger {cat_m.group(1)}" if cat_m else None

                name = f"{city} CH"
                tid = f"wiki_ch_{SEASON}_{name[:35].replace(' ', '_')}_{start_date}"
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
                    "season":            SEASON,
                    "is_auto_populated": True,
                })
    except Exception as e:
        print(f"   Wikipedia fetch failed (ATP Challenger): {e}")

    print(f"   ATP Challenger 2025: {len(tournaments)} tournaments parsed.")
    return tournaments


# ── Supabase upsert (same keying strategy as tourly_scraper.py) ──────────────

def get_supabase_client():
    from supabase import create_client
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise EnvironmentError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.")
    return create_client(url, key)


def upsert_tournament(sb, data: dict) -> str:
    """Insert-or-update by itf_id (or name+start_date fallback). Never deletes."""
    itf_id = data.get("itf_id") or ""
    if itf_id:
        existing = sb.table("itf_tournaments").select("id").eq("itf_id", itf_id).execute()
    else:
        existing = sb.table("itf_tournaments").select("id") \
            .eq("name", data["name"]).eq("start_date", data["start_date"]).execute()

    if not data.get("start_date"):
        return "skipped"

    if existing.data:
        updates = {k: v for k, v in data.items() if v is not None}
        sb.table("itf_tournaments").update(updates).eq("id", existing.data[0]["id"]).execute()
        return "updated"
    else:
        sb.table("itf_tournaments").insert(data).execute()
        return "added"


def print_samples(label: str, rows: list[dict], n: int = 10):
    print(f"\n--- {label}: {len(rows)} total, showing up to {n} samples ---")
    for row in rows[:n]:
        print(f"  {row['start_date']}  {row['name']!r:40s} "
              f"surface={row.get('surface')!r} category={row.get('category')!r} "
              f"season={row.get('season')}")


async def run(apply_changes: bool):
    itf_rows = await fetch_itf_2025()
    ch_rows  = await fetch_atp_challenger_2025()

    print_samples("ITF 2025", itf_rows)
    print_samples("ATP Challenger 2025", ch_rows)

    total = len(itf_rows) + len(ch_rows)
    print(f"\n{'='*52}\nTOTAL 2025 tournaments parsed: {total} "
          f"(ITF={len(itf_rows)}, Challenger={len(ch_rows)})\n{'='*52}")

    if not apply_changes:
        print("\nDRY RUN — nothing written. Re-run with --apply to upsert into Supabase.")
        return

    sb = get_supabase_client()
    stats = {"added": 0, "updated": 0, "skipped": 0}
    for row in itf_rows + ch_rows:
        action = upsert_tournament(sb, row)
        stats[action] = stats.get(action, 0) + 1
    print(f"\nUpsert complete — added={stats['added']} updated={stats['updated']} "
          f"skipped={stats['skipped']}")


def main():
    apply_changes = "--apply" in sys.argv
    if not apply_changes:
        print("Running in DRY-RUN mode (default). Pass --apply to write to Supabase.\n")
    asyncio.run(run(apply_changes))


if __name__ == "__main__":
    main()
