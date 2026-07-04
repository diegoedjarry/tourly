"""
Network-free unit tests for scraper/itf_results.cross_check().

Run: python test_crosscheck.py
All cases must print PASS. Any FAIL is a breaking regression.

These tests never hit the network — MatchResult lists are constructed by hand
to stand in for what fetch_player_results() would have returned, so the
suite is fast and deterministic in CI.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from itf_results import MatchResult, Discrepancy, cross_check, normalise_score, names_match, summarise

PASS = 0
FAIL = 0


def check(label, actual, expected):
    global PASS, FAIL
    if actual == expected:
        print(f"  PASS  {label}")
        PASS += 1
    else:
        print(f"  FAIL  {label}")
        print(f"        expected: {expected!r}")
        print(f"        actual:   {actual!r}")
        FAIL += 1


def ta_entry(tournament, matches):
    """Build a minimal TA match_history entry."""
    return {"tournamentName": tournament, "matches": matches}


def ta_match(round_, opponent, score, won, qualifying=False):
    return {"round": round_, "opponent": opponent, "score": score, "playerWon": won, "qualifying": qualifying}


# ═══════════════════════════════════════════════════════════════════
# CASE 1 — agreeing histories → no flags
# ═══════════════════════════════════════════════════════════════════
print("\nCASE 1 — agreeing histories")
ta_history = [
    ta_entry("Manama 2 CH", [
        ta_match("R32", "Lorenzo Binda (900)", "6-3 7-5", True),
        ta_match("R16", "Ivan Marrero Curbelo (450)", "6-4 6-3", False),
    ]),
]
alt = [
    MatchResult(tournament="ITF M25 Manama 2 Men", date="2025-03-16", opponent="Lorenzo Binda", won=True, score="6-3 7-5"),
    MatchResult(tournament="ITF M25 Manama 2 Men", date="2025-03-17", opponent="Ivan Marrero Curbelo", won=False, score="6-4 6-3"),
]
flags = cross_check(ta_history, alt)
check("no discrepancies", flags, [])

# ═══════════════════════════════════════════════════════════════════
# CASE 2 — flipped winner → HIGH
# ═══════════════════════════════════════════════════════════════════
print("\nCASE 2 — flipped winner")
ta_history2 = [
    ta_entry("Temuco CH", [
        ta_match("QF", "Juan Carlos Prado Angelo (300)", "6-4 7-6(4)", False),
    ]),
]
alt2 = [
    MatchResult(tournament="Challenger Temuco", date="2025-05-01", opponent="Juan Carlos Prado Angelo", won=True, score="4-6 6-7"),
]
flags2 = cross_check(ta_history2, alt2)
check("one HIGH flag", len(flags2), 1)
check("severity HIGH", flags2[0].severity if flags2 else None, "HIGH")
check("kind conflicting_result", flags2[0].kind if flags2 else None, "conflicting_result")

# ═══════════════════════════════════════════════════════════════════
# CASE 3 — missing match in alt source (same tournament, no matching opponent) → LOW
# ═══════════════════════════════════════════════════════════════════
print("\nCASE 3 — missing match in alt source")
ta_history3 = [
    ta_entry("Creteil CH", [
        ta_match("R32", "Someone Unmatched", "6-2 6-1", True),
    ]),
]
alt3 = [
    # Same tournament present in alt source, but no match against this opponent
    MatchResult(tournament="ITF M25 Creteil", date="2025-04-01", opponent="A Totally Different Player", won=True, score="6-0 6-0"),
]
flags3 = cross_check(ta_history3, alt3)
check("one LOW flag", len(flags3), 1)
check("severity LOW", flags3[0].severity if flags3 else None, "LOW")
check("kind missing_in_alt_source", flags3[0].kind if flags3 else None, "missing_in_alt_source")

# ═══════════════════════════════════════════════════════════════════
# CASE 4 — score-format variants + diacritic names → no false positives
# ═══════════════════════════════════════════════════════════════════
print("\nCASE 4 — score-format variants + diacritics")
ta_history4 = [
    ta_entry("Asuncion CH", [
        # TA score with retirement marker, opponent with diacritics
        ta_match("R16", "Śliwiński Adrián", "6-2 3-1 ret.", True),
    ]),
]
alt4 = [
    # Alt source: no accents, dash variant, no ret. marker (scores agree once normalised)
    MatchResult(tournament="Challenger Asuncion", date="2025-06-10", opponent="Sliwinski Adrian", won=True, score="6–2 3–1"),
]
flags4 = cross_check(ta_history4, alt4)
check("no false positive on diacritics/ret./dash variants", flags4, [])

# Sub-checks on the normalisation helpers directly
check("normalise_score strips ret.", normalise_score("6-2 3-1 ret."), "6-2 3-1")
check("normalise_score handles en-dash", normalise_score("6–2 3–1"), "6-2 3-1")
check("names_match folds diacritics", names_match("Śliwiński Adrián", "Sliwinski Adrian"), True)
check("names_match last-name fallback", names_match("I. Marrero Curbelo", "Ivan Marrero Curbelo"), True)

# ═══════════════════════════════════════════════════════════════════
# CASE 5 — alt source unavailable (None) → no flags, no crash
# ═══════════════════════════════════════════════════════════════════
print("\nCASE 5 — alt source unavailable")
flags5 = cross_check(ta_history, None)
check("unavailable source yields no flags", flags5, [])

# ═══════════════════════════════════════════════════════════════════
# CASE 6 — TA match with unconfirmed result (playerWon=None) is skipped, not flagged
# ═══════════════════════════════════════════════════════════════════
print("\nCASE 6 — unconfirmed TA result is skipped")
ta_history6 = [
    ta_entry("Cary CH", [
        ta_match("R32", "Unresolved Name", "6-2 6-1", None),
    ]),
]
alt6 = [
    MatchResult(tournament="Challenger Cary", date="2025-02-01", opponent="Unresolved Name", won=False, score="2-6 1-6"),
]
flags6 = cross_check(ta_history6, alt6)
check("unconfirmed TA result produces no flag", flags6, [])

# ═══════════════════════════════════════════════════════════════════
# CASE 7 — summarise() formatting
# ═══════════════════════════════════════════════════════════════════
print("\nCASE 7 — summarise() formatting")
check("clean summary", summarise([]), "xcheck: clean")
mixed = [
    Discrepancy("HIGH", "conflicting_result", "T", "O", "d"),
    Discrepancy("HIGH", "conflicting_result", "T", "O2", "d"),
    Discrepancy("LOW", "missing_in_alt_source", "T", "O3", "d"),
]
check("mixed summary", summarise(mixed), "xcheck: 2 HIGH, 1 LOW discrepancies")

# ── Report ───────────────────────────────────────────────────────────
print(f"\n{'='*52}\n  {PASS} passed, {FAIL} failed\n{'='*52}")
sys.exit(1 if FAIL else 0)
