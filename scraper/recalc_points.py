"""
Recalculate pointsEarned for every stored match_history entry using the
corrected points tables and qualifying points logic. No re-scraping.
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv
load_dotenv()
from tourly_scraper import TennisAbstractScraper, TourlyDataIntegrator

scraper    = TennisAbstractScraper()
integrator = TourlyDataIntegrator()
sb         = integrator.sb

rows = sb.table("player_profiles").select("player_name,match_history").execute()

for row in rows.data or []:
    player    = row["player_name"]
    mh        = row.get("match_history") or []
    changed   = 0
    for entry in mh:
        tourn       = entry.get("tournamentName", "")
        rnd         = entry.get("roundReached", "")
        matches     = entry.get("matches") or []
        q_matches   = [m for m in matches if m.get("qualifying")]
        md_matches  = [m for m in matches if not m.get("qualifying")]
        cat         = scraper._infer_category(tourn)

        # Determine if the deepest-round main-draw match was a win or loss.
        # If it was a win, points go to the next round (the one advanced to).
        pts_rnd = rnd
        if rnd and md_matches:
            deepest = [m for m in md_matches if m.get("round", "").upper() == rnd.upper()]
            if deepest:
                score = deepest[0].get("score", "")
                ps, os_ = 0, 0
                import re as _re
                for part in score.split():
                    mx = _re.match(r"^(\d+)-(\d+)", part)
                    if mx:
                        a, b = int(mx.group(1)), int(mx.group(2))
                        if a > b: ps += 1
                        elif b > a: os_ += 1
                if ps > os_:
                    pts_rnd = scraper._NEXT_ROUND.get(rnd, rnd)

        md_pts      = scraper.calc_itf_points(cat, pts_rnd)
        q_pts       = scraper.calc_qualifying_points(cat, q_matches, rnd)
        new_pts     = md_pts + q_pts
        old_pts     = entry.get("pointsEarned", 0)
        if new_pts != old_pts:
            entry["pointsEarned"] = new_pts
            changed += 1
            print(f"  [{player}] {tourn} rnd={rnd!r} cat={cat} "
                  f"md={md_pts} q={q_pts} total={new_pts}  (was {old_pts})")
    if changed:
        sb.table("player_profiles").update({"match_history": mh}) \
            .eq("player_name", player).execute()
        print(f"  → Updated {player}: {changed} entries recalculated")
    else:
        print(f"  {player}: no changes")

print("\nDone. Run verification query next.")
