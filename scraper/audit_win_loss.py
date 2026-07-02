"""
Re-scrape all players and compare old vs new wins/losses for every
match_history entry. Shows which entries changed and updates the DB.
"""
import asyncio, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv
load_dotenv()
from tourly_scraper import TennisAbstractScraper, TourlyDataIntegrator

scraper    = TennisAbstractScraper()
integrator = TourlyDataIntegrator()
sb         = integrator.sb

async def main():
    rows = sb.table("player_profiles").select("player_name,match_history").execute()
    players = {r["player_name"]: (r.get("match_history") or []) for r in (rows.data or [])}
    print(f"Loaded {len(players)} players from DB\n")

    grand_total_changed = 0

    for player_name, old_mh in players.items():
        print(f"\n{'='*60}")
        print(f"Re-scraping: {player_name}")
        print(f"{'='*60}")

        try:
            profile = await scraper.scrape_player(player_name)
        except Exception as e:
            print(f"  ✗ Scrape failed: {e}")
            continue

        new_mh = profile.get("match_history") or []
        if not new_mh:
            print(f"  ⚠ Empty result — skipping (guard would block overwrite anyway)")
            continue

        # Build lookup: old data keyed by (tournamentName, date)
        old_by_key = {
            (e.get("tournamentName",""), e.get("date","")): e
            for e in old_mh
        }

        changed_entries = 0
        header_printed  = False

        for new_entry in new_mh:
            key = (new_entry.get("tournamentName",""), new_entry.get("date",""))
            old_entry = old_by_key.get(key)

            nw = new_entry.get("wins", 0)
            nl = new_entry.get("losses", 0)
            ow = old_entry.get("wins", 0)  if old_entry else "?"
            ol = old_entry.get("losses", 0) if old_entry else "?"
            np = new_entry.get("pointsEarned", 0)
            op = old_entry.get("pointsEarned", 0) if old_entry else "?"

            wins_changed   = (ow != nw) if old_entry else True
            losses_changed = (ol != nl) if old_entry else True
            pts_changed    = (op != np) if old_entry else True
            any_changed    = wins_changed or losses_changed or pts_changed

            marker = "✎" if any_changed else " "
            if any_changed:
                changed_entries += 1

            if any_changed or True:  # show all rows so user has full picture
                if not header_printed:
                    print(f"\n  {'Tournament':<35} {'Rnd':<5} {'W old→new':>10} {'L old→new':>10} {'Pts old→new':>12}")
                    print(f"  {'-'*35} {'-'*5} {'-'*10} {'-'*10} {'-'*12}")
                    header_printed = True

                tourn = new_entry.get("tournamentName","")[:34]
                rnd   = new_entry.get("roundReached","")
                w_str = f"{ow}→{nw}" if wins_changed   else f"{nw}"
                l_str = f"{ol}→{nl}" if losses_changed else f"{nl}"
                p_str = f"{op}→{np}" if pts_changed    else f"{np}"
                print(f"  {marker} {tourn:<34} {rnd:<5} {w_str:>10} {l_str:>10} {p_str:>12}")

        if not header_printed:
            print("  (no entries)")

        grand_total_changed += changed_entries
        print(f"\n  → {changed_entries} entries changed for {player_name}")

        # Write corrected data back to DB
        integrator.upsert_player_profile(profile)
        print(f"  ✓ DB updated")

    print(f"\n{'='*60}")
    print(f"DONE. Total entries changed across all players: {grand_total_changed}")
    print(f"{'='*60}")

asyncio.run(main())
