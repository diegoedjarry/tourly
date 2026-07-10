"""
ITF Results Cross-Check (Sofascore)
------------------------------------
Independent, SECOND source of ITF/Challenger match results used ONLY to
cross-check Tennis Abstract (TA) — the app's sole player-results source today.

Design contract (do not violate):
  - This module is READ-ONLY / FLAG-ONLY. It never writes to Supabase and never
    mutates a caller's match_history. `cross_check()` returns a list of typed
    Discrepancy objects; the caller decides what (if anything) to do with them
    (see tourly_scraper.run_player_phase — currently: log + console warning).
  - `fetch_player_results()` NEVER raises. Any failure (network, parsing,
    player not found) results in `None`, meaning "source unavailable" — the
    caller must treat that as a no-op, not an error.

Source chosen: Sofascore's public JSON API (already used elsewhere in this
scraper for the ITF calendar — see ITFTournamentScraper). Verified live
2026-07: `/search/all?q=<name>` resolves a tennis player to a `team` id (yes,
individual tennis players are modeled as `team` entities in this API), then
`/team/{id}/events/last/{page}` returns paginated completed match history with
tournament name, opponent name, per-set scores, and winnerCode (1=home won,
2=away won). No auth/session warmup required, unlike atptour.com.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from curl_cffi.requests import AsyncSession

SOFASCORE_API = "https://api.sofascore.com/api/v1"
SOFASCORE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Referer": "https://www.sofascore.com/",
}

# Safety cap: never page through more than this many pages of history per
# player per run (each page ~= 30 events). Keeps the cross-check fast and
# bounded even for very active players.
MAX_PAGES = 4


# ── Typed result / discrepancy models ───────────────────────────────────────

@dataclass
class MatchResult:
    """One completed match from the alt source (Sofascore), normalised."""
    tournament: str
    date: Optional[str]        # "YYYY-MM-DD" or None if unparseable
    opponent: str
    won: Optional[bool]        # True/False; None if indeterminate
    score: str                 # normalised set-score string, e.g. "6-2 6-3"


@dataclass
class Discrepancy:
    """
    A single flagged inconsistency between Tennis Abstract (TA) and the
    alt source. Informational only — never used to mutate stored data.
    """
    severity: str               # "HIGH" or "LOW"
    kind: str                   # "conflicting_result" | "missing_in_alt_source"
    tournament: str
    opponent: str
    detail: str
    ta_value: Optional[str] = None
    alt_value: Optional[str] = None

    def __str__(self) -> str:
        return f"[{self.severity}] {self.kind} — {self.tournament} vs {self.opponent}: {self.detail}"


# ── Name / score normalisation helpers ──────────────────────────────────────

def _fold_diacritics(s: str) -> str:
    norm = unicodedata.normalize("NFKD", s)
    return "".join(c for c in norm if not unicodedata.combining(c))


def _normalise_name(s: str) -> str:
    """Lowercase, diacritic-folded, punctuation-stripped name for matching."""
    s = _fold_diacritics(s or "")
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s


def _last_name(s: str) -> str:
    norm = _normalise_name(s)
    parts = norm.split()
    return parts[-1] if parts else ""


def names_match(a: str, b: str) -> bool:
    """
    Fuzzy opponent-name match: diacritic-folded, then either a direct
    substring match (handles initials / partial names like TA's
    "Ivan Marrero Curbelo" vs Sofascore's "I. Marrero Curbelo") or a
    last-name match (handles ordering/format differences).
    """
    na, nb = _normalise_name(a), _normalise_name(b)
    if not na or not nb:
        return False
    if na == nb or na in nb or nb in na:
        return True
    return bool(_last_name(a)) and _last_name(a) == _last_name(b)


def _normalise_tournament(s: str) -> str:
    """Loose tournament-name key for overlap matching (case/space-insensitive,
    strips common suffixes like 'Men'/'CH'/tier numbers so TA's 'Manama 2 CH'
    and Sofascore's 'ITF M25 Manama 2 Men' can still be linked by city token)."""
    n = _normalise_name(s)
    n = re.sub(r"\b(itf|m1[05]|m2[05]|w\d+|ch\d*|challenger|men|women)\b", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n


_RET_WO_RE = re.compile(r"\b(ret\.?|retired|w\.?o\.?|walkover|def\.?)\b", re.IGNORECASE)
_SET_RE = re.compile(r"(\d+)\s*[-–—]\s*(\d+)(?:\((\d+)\))?")


def normalise_score(raw: str) -> str:
    """
    Normalise a score string for comparison: strips retirement/walkover
    markers, collapses whitespace/dash variants, drops tiebreak parenthetical
    detail (keeps set scores only) — e.g. "6-4 7-6(4) ret." -> "6-4 7-6".
    """
    if not raw:
        return ""
    cleaned = _RET_WO_RE.sub("", raw)
    sets = []
    for m in _SET_RE.finditer(cleaned):
        a, b = m.group(1), m.group(2)
        sets.append(f"{a}-{b}")
    return " ".join(sets)


def _sets_swapped(score: str) -> str:
    """Swap winner/loser perspective in a normalised set-score string,
    e.g. '6-4 7-5' -> '4-6 5-7' (used because TA/Sofascore can each report
    scores from either player's perspective)."""
    out = []
    for part in score.split():
        m = re.match(r"^(\d+)-(\d+)$", part)
        if m:
            out.append(f"{m.group(2)}-{m.group(1)}")
        else:
            out.append(part)
    return " ".join(out)


def scores_equivalent(a: str, b: str) -> bool:
    na, nb = normalise_score(a), normalise_score(b)
    if not na or not nb:
        return True  # can't compare — don't flag on missing/unparseable scores
    return na == nb or na == _sets_swapped(nb)


# ── Sofascore fetch ──────────────────────────────────────────────────────────

def _period_score(score_obj: dict) -> list[int]:
    """Extract ordered set scores (period1, period2, ...) from a Sofascore
    homeScore/awayScore object, stopping at the first missing period."""
    out = []
    i = 1
    while True:
        key = f"period{i}"
        if key not in score_obj or score_obj.get(key) is None:
            break
        out.append(score_obj[key])
        i += 1
    return out


def _event_to_score_str(home_sets: list[int], away_sets: list[int], player_is_home: bool) -> str:
    player_sets = home_sets if player_is_home else away_sets
    opp_sets = away_sets if player_is_home else home_sets
    parts = []
    for p, o in zip(player_sets, opp_sets):
        parts.append(f"{p}-{o}")
    return " ".join(parts)


def _ts_to_date(ts: Optional[int]) -> Optional[str]:
    if not ts:
        return None
    try:
        return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
    except (ValueError, OSError, OverflowError):
        return None


async def _resolve_player_id(client: AsyncSession, player_name: str) -> Optional[int]:
    """Resolve a player name to a Sofascore team-entity id via search.
    Requires an exact (case/diacritic-insensitive) name match; only falls back
    to an unmatched result when it is the SINGLE tennis-player hit — guessing
    among several candidates risks cross-checking against the wrong player
    (common surnames), producing false HIGH discrepancies."""
    try:
        r = await client.get(
            f"{SOFASCORE_API}/search/all",
            params={"q": player_name},
            headers=SOFASCORE_HEADERS,
            timeout=15,
        )
        if r.status_code != 200:
            return None
        results = (r.json() or {}).get("results", [])
    except Exception:
        return None

    tennis_players = [
        res["entity"] for res in results
        if isinstance(res, dict)
        and res.get("entity", {}).get("sport", {}).get("slug") == "tennis"
        and res.get("entity", {}).get("type") == 1  # 1 = individual player
    ]
    if not tennis_players:
        return None

    for ent in tennis_players:
        if names_match(ent.get("name", ""), player_name):
            return ent.get("id")
    if len(tennis_players) == 1:
        return tennis_players[0].get("id")
    return None  # multiple candidates, none matches — skip cross-check, don't guess


async def fetch_player_results(player_name: str, since_date: Optional[str] = None) -> Optional[list[MatchResult]]:
    """
    Fetch a player's completed ITF/Challenger match results from Sofascore.

    Returns:
        list[MatchResult] — possibly empty if the player was found but has no
                             completed matches on record.
        None               — source unavailable (network error, player not
                             found, or any other failure). Never raises.

    since_date: optional "YYYY-MM-DD" lower bound; matches strictly before
    this date are excluded once encountered (pagination stops early since
    Sofascore returns events newest-first).
    """
    try:
        async with AsyncSession(impersonate="chrome120") as client:
            player_id = await _resolve_player_id(client, player_name)
            if not player_id:
                return None

            results: list[MatchResult] = []
            for page in range(MAX_PAGES):
                try:
                    r = await client.get(
                        f"{SOFASCORE_API}/team/{player_id}/events/last/{page}",
                        headers=SOFASCORE_HEADERS,
                        timeout=20,
                    )
                except Exception:
                    break
                if r.status_code == 404:
                    break  # no more pages
                if r.status_code != 200:
                    break
                try:
                    events = (r.json() or {}).get("events", [])
                except Exception:
                    break
                if not events:
                    break

                stop_paging = False
                for e in events:
                    try:
                        if (e.get("status", {}) or {}).get("type") != "finished":
                            continue
                        home = e.get("homeTeam", {}) or {}
                        away = e.get("awayTeam", {}) or {}
                        player_is_home = names_match(home.get("name", ""), player_name) or home.get("id") == player_id
                        opponent = away.get("name") if player_is_home else home.get("name")
                        opponent = opponent or ""

                        date_str = _ts_to_date(e.get("startTimestamp"))
                        if since_date and date_str and date_str < since_date:
                            stop_paging = True
                            continue

                        home_sets = _period_score(e.get("homeScore", {}) or {})
                        away_sets = _period_score(e.get("awayScore", {}) or {})
                        score_str = _event_to_score_str(home_sets, away_sets, player_is_home)

                        winner_code = e.get("winnerCode")
                        won: Optional[bool] = None
                        if winner_code == 1:
                            won = player_is_home
                        elif winner_code == 2:
                            won = not player_is_home

                        tournament = (
                            (e.get("tournament", {}) or {}).get("name")
                            or ((e.get("tournament", {}) or {}).get("uniqueTournament", {}) or {}).get("name")
                            or ""
                        )

                        results.append(MatchResult(
                            tournament=tournament,
                            date=date_str,
                            opponent=opponent,
                            won=won,
                            score=score_str,
                        ))
                    except Exception:
                        continue  # skip malformed individual event, keep going

                if stop_paging or len(events) < 20:
                    # fewer than a full page (or we hit the since_date bound) — no need to page further
                    break

            return results
    except Exception:
        return None


# ── Cross-check ────────────────────────────────────────────────────────────

def _ta_matches_iter(ta_history: list[dict]):
    """Yield (tournament_name, opponent_raw, won, score) for every non-qualifying,
    result-confirmed TA match entry."""
    for entry in ta_history or []:
        tourn = entry.get("tournamentName") or ""
        for m in entry.get("matches") or []:
            if m.get("qualifying"):
                continue
            won = m.get("playerWon")
            if won is None:
                continue  # TA itself couldn't confirm this one — nothing to cross-check
            opponent = m.get("opponent") or ""
            # Strip trailing "(rank)" suffix TA appends, e.g. "Ivan Marrero Curbelo (450)"
            opponent = re.sub(r"\s*\(\d+\)\s*$", "", opponent).strip()
            yield tourn, opponent, bool(won), m.get("score") or ""


def cross_check(ta_history: list[dict], alt_results: Optional[list[MatchResult]]) -> list[Discrepancy]:
    """
    Compare Tennis Abstract match_history against alt-source results and
    return a list of Discrepancy flags. Pure function — reads both inputs,
    mutates neither, and never touches storage.

    A discrepancy is raised when, for the SAME tournament (loose name match)
    and SAME opponent (fuzzy name match):
      - TA and the alt source disagree on won/lost              -> HIGH
      - TA and the alt source disagree on score (both present)  -> HIGH
      - a TA match has no corresponding completed match in the
        alt source's results for that tournament                -> LOW

    If alt_results is None (source unavailable), returns [] — "nothing to
    report" rather than treating unavailability itself as a discrepancy.
    """
    if alt_results is None:
        return []

    flags: list[Discrepancy] = []

    # Bucket alt results by normalised tournament key for cheap overlap lookup.
    alt_by_tournament: dict[str, list[MatchResult]] = {}
    for r in alt_results:
        key = _normalise_tournament(r.tournament)
        alt_by_tournament.setdefault(key, []).append(r)

    for tourn, opponent, ta_won, ta_score in _ta_matches_iter(ta_history):
        tourn_key = _normalise_tournament(tourn)
        candidates = alt_by_tournament.get(tourn_key, [])
        if not candidates:
            # No overlap at all for this tournament in the alt source — not
            # necessarily a discrepancy (alt source may simply not cover it).
            continue

        match = next((c for c in candidates if names_match(c.opponent, opponent)), None)
        if match is None:
            flags.append(Discrepancy(
                severity="LOW",
                kind="missing_in_alt_source",
                tournament=tourn,
                opponent=opponent,
                detail="TA match has no corresponding completed match in alt source for this event.",
                ta_value=f"won={ta_won} score={ta_score}",
                alt_value=None,
            ))
            continue

        if match.won is not None and match.won != ta_won:
            flags.append(Discrepancy(
                severity="HIGH",
                kind="conflicting_result",
                tournament=tourn,
                opponent=opponent,
                detail="Win/loss disagreement between TA and alt source.",
                ta_value=f"won={ta_won}",
                alt_value=f"won={match.won}",
            ))
            continue

        if ta_score and match.score and not scores_equivalent(ta_score, match.score):
            flags.append(Discrepancy(
                severity="HIGH",
                kind="conflicting_result",
                tournament=tourn,
                opponent=opponent,
                detail="Score disagreement between TA and alt source.",
                ta_value=ta_score,
                alt_value=match.score,
            ))

    return flags


def summarise(discrepancies: list[Discrepancy]) -> str:
    """One-line summary for scraper_runs.error, e.g. 'xcheck: 2 HIGH, 1 LOW discrepancies'."""
    high = sum(1 for d in discrepancies if d.severity == "HIGH")
    low = sum(1 for d in discrepancies if d.severity == "LOW")
    if not high and not low:
        return "xcheck: clean"
    parts = []
    if high:
        parts.append(f"{high} HIGH")
    if low:
        parts.append(f"{low} LOW")
    return f"xcheck: {', '.join(parts)} discrepancies"
