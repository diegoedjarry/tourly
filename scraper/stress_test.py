"""
Tennis Abstract scraper stress test — 6 players
Reports URL resolution, data quality, and page structure consistency.
"""
import asyncio, os, sys, json, re
from datetime import datetime, timezone

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

from dotenv import load_dotenv
load_dotenv()

# Credentials come from the environment only (see scraper/.env.example).
if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_SERVICE_KEY"):
    sys.exit("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY — configure scraper/.env first.")

sys.path.insert(0, os.path.dirname(__file__))
from tourly_scraper import TennisAbstractScraper, TourlyDataIntegrator

PLAYERS = [
    "Logan Zapp",
    "Roan Jones",
    "Tomas Martinez",
    "Niels Ratiu",
    "Preston Brown",
    "Patricio Betancourt",
]

def analyse_matches(match_history: list) -> dict:
    total = len(match_history)
    with_matches = sum(1 for m in match_history if m.get("matches"))
    empty_matches = total - with_matches
    doubles_slipped = []
    for m in match_history:
        for mx in (m.get("matches") or []):
            score = mx.get("score", "")
            # Doubles tiebreak format: any set with score >= 8 is sus
            sets = re.findall(r'(\d+)-(\d+)', score)
            for a, b in sets:
                if int(a) > 7 or int(b) > 7:
                    doubles_slipped.append({"tourn": m.get("tournamentName"), "score": score})
                    break
    # Sample entries
    samples = []
    for m in match_history[:3]:
        entry = {
            "tournamentName": m.get("tournamentName"),
            "date": m.get("date"),
            "surface": m.get("surface"),
            "roundReached": m.get("roundReached"),
        }
        first_match = (m.get("matches") or [None])[0]
        if first_match:
            entry["opponent"] = first_match.get("opponent")
            entry["score"] = first_match.get("score")
        samples.append(entry)
    return {
        "total": total,
        "with_matches": with_matches,
        "empty_matches": empty_matches,
        "doubles_slipped": doubles_slipped,
        "samples": samples,
    }

async def test_player(scraper: TennisAbstractScraper, name: str) -> dict:
    print(f"\n{'='*60}")
    print(f"TESTING: {name}")
    print('='*60)
    result = {"name": name, "found": False, "profile": None, "analysis": None, "error": None}
    try:
        profile = await scraper.scrape_player(name, store_name=name)
        if profile is None:
            print(f"  ✗  Not found on Tennis Abstract")
            result["found"] = False
        else:
            result["found"] = True
            result["profile"] = profile
            mh = profile.get("match_history") or []
            result["analysis"] = analyse_matches(mh)
            print(f"  Ranking:       {profile.get('current_ranking')}")
            print(f"  Match history: {result['analysis']['total']} entries "
                  f"({result['analysis']['with_matches']} with scores, "
                  f"{result['analysis']['empty_matches']} empty)")
            if result["analysis"]["doubles_slipped"]:
                print(f"  ⚠  DOUBLES DETECTED: {result['analysis']['doubles_slipped'][:3]}")
            else:
                print(f"  ✓  No doubles contamination detected")
            print(f"\n  --- Sample match entries ---")
            for s in result["analysis"]["samples"]:
                print(f"  {s}")
    except Exception as e:
        result["error"] = str(e)
        print(f"  ✗  ERROR: {e}")
    await asyncio.sleep(7)  # polite rate limit
    return result

async def main():
    scraper = TennisAbstractScraper()
    integrator = TourlyDataIntegrator()

    results = []
    for name in PLAYERS:
        r = await test_player(scraper, name)
        results.append(r)

    # Summary
    print(f"\n{'='*60}")
    print("SUMMARY")
    print('='*60)
    found = [r for r in results if r["found"]]
    not_found = [r for r in results if not r["found"] and not r["error"]]
    errored = [r for r in results if r["error"]]
    print(f"Found:     {len(found)}/6 — {[r['name'] for r in found]}")
    print(f"Not found: {len(not_found)}/6 — {[r['name'] for r in not_found]}")
    print(f"Errors:    {len(errored)}/6 — {[r['name'] for r in errored]}")

    # Store in Supabase
    print(f"\n{'='*60}")
    print("STORING IN SUPABASE")
    print('='*60)
    for r in found:
        try:
            integrator.upsert_player_profile(r["profile"])
        except Exception as e:
            print(f"  ✗  Failed to store {r['name']}: {e}")

    # Final data quality report
    print(f"\n{'='*60}")
    print("DATA QUALITY REPORT")
    print('='*60)
    for r in results:
        if r["found"] and r["analysis"]:
            a = r["analysis"]
            ranking = r["profile"].get("current_ranking")
            doubles_ok = "✓" if not a["doubles_slipped"] else f"⚠ {len(a['doubles_slipped'])} doubles"
            print(f"  {r['name']:25s} | rank {str(ranking):6s} | {a['total']:2d} matches ({a['with_matches']} w/scores) | doubles: {doubles_ok}")
        elif r["error"]:
            print(f"  {r['name']:25s} | ERROR: {r['error'][:60]}")
        else:
            print(f"  {r['name']:25s} | NOT FOUND")

if __name__ == "__main__":
    asyncio.run(main())
