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
# The 2025 ATP Challenger Tour Wikipedia page is structured as one wikitable
# PER MONTH under "== Schedule ==" (=== January === ... === November ===),
# NOT the Tournament/Date/City/Surface column layout used elsewhere. Each
# table row block looks like (wikitext, one physical line per `|-valign=top`
# row):
#
#   |rowspan=6|December 30||rowspan=2|[[2025 Canberra Tennis International|
#   Canberra Tennis International]]<br/>[[Canberra]], Australia <br/>
#   Hard – Challenger 125 – 32S/24Q/16D<br/>[[...Singles]] – [[...Doubles]]
#   || {{champion}} || {{runner-up}} ||rowspan=2|{{semifinalists}}
#   ||rowspan=2|{{quarterfinalists}}
#   |-valign=top
#   | {{champion pairing line 2 / score}} || {{runner-up line 2}}
#
# i.e. each tournament occupies a 2-physical-row block (the `rowspan=2` on
# the tournament/semis/QF cells spans both), and the leading `rowspan=N`
# "Week of" cell groups N/2 tournaments that share a start date. There is no
# separate date/surface/category column — surface and category are embedded
# in the tournament cell's second wikitext line as
# "<Surface> – Challenger <tier> – <draw sizes>". No per-event prize figure
# is published on this page (only a season-wide "$60,000 up to $250,000"
# range in the lede), so prize_money_total is derived entirely from the tier.
#
# Wikipedia rowspan bookkeeping in raw wikitext is unreliable to replay
# exactly, so instead of tracking rowspans we scan line-by-line and just
# remember the *last seen* "Week of" date, applying it to every subsequent
# tournament cell until a new date cell appears — this is equivalent to what
# the rowspan grouping encodes, without needing to count remaining spans.

_CH_CATEGORY_RE = re.compile(r"\bChallenger\s*(\d{2,3})\b", re.IGNORECASE)

_CH_TIER_PRIZE = {50: 40000, 75: 60000, 100: 80000, 125: 120000, 175: 220000}

_CH_MONTH_MAP = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}

# "Week of" cell, e.g. "|rowspan=6|December 30" or "|rowspan=10|February 3".
_CH_WEEKOF_RE = re.compile(
    r"^\|(?:rowspan=\d+\|)?(" + "|".join(_CH_MONTH_MAP) + r")\s+(\d{1,2})\s*(?:\|\||$)",
    re.IGNORECASE,
)

# Tournament cell: [[Tournament]]<br/>[[City]], Country <br/> Surface – Challenger NNN – draw
_CH_TOURN_RE = re.compile(
    r"\[\[(?:[^\]|]+\|)?([^\]]+)\]\]\s*<br\s*/?>\s*"          # tournament name
    r"\[\[(?:[^\]|]+\|)?([^\]]+)\]\],?\s*([^<]*?)\s*<br\s*/?>\s*"  # city, country
    r"([A-Za-z]+(?:\s*\(i\))?)\s*[–-]\s*Challenger\s*(\d{2,3})",  # surface – Challenger NNN
    re.IGNORECASE,
)

# A stray per-event prize figure, if ever present, e.g. "$45,000".
_CH_PRIZE_RE = re.compile(r"\$([\d,]{4,})")


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

            current_month: Optional[int] = None
            current_day: Optional[int] = None

            for raw_line in wikitext.splitlines():
                line = raw_line.strip()
                if not line.startswith("|"):
                    continue

                wm = _CH_WEEKOF_RE.match(line)
                if wm:
                    month_name = wm.group(1).lower()
                    current_month = _CH_MONTH_MAP[month_name]
                    current_day = int(wm.group(2))
                    # Fall through: the same physical line also contains the
                    # first tournament cell, so don't `continue` here.

                tm = _CH_TOURN_RE.search(line)
                if not tm or current_month is None:
                    continue

                name = re.sub(r"\s+", " ", tm.group(1)).strip()
                city = re.sub(r"\s+", " ", tm.group(2)).strip()
                country = re.sub(r"\[\[|\]\]", "", tm.group(3)).strip(", ").strip()
                surface_raw = tm.group(4)
                tier = int(tm.group(5))

                surface = normalise_surface(surface_raw)
                category = f"Challenger {tier}"

                # "Week of" dates near year boundaries (e.g. "December 30")
                # belong to the previous calendar year even though they're
                # listed on the 2025 page as lead-in weeks.
                year = SEASON
                if current_month == 12:
                    year = SEASON - 1

                try:
                    start_date = datetime(year, current_month, current_day).strftime("%Y-%m-%d")
                except (ValueError, TypeError):
                    continue

                prize_money_total = _CH_TIER_PRIZE.get(tier)
                pm = _CH_PRIZE_RE.search(line)
                if pm and prize_money_total is not None:
                    try:
                        parsed_prize = int(pm.group(1).replace(",", ""))
                        prize_money_total = min(prize_money_total, parsed_prize)
                    except ValueError:
                        pass

                tid = f"wiki25_ch_{name[:40].replace(' ', '_')}_{start_date}"
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
                    "prize_money_total": prize_money_total,
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
