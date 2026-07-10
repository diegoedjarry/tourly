"""
Guard test: simulate a scrape returning empty match_history for Roan Jones
(the one player who still has real data). Confirm the guard blocks the overwrite.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv
load_dotenv()

from tourly_scraper import TourlyDataIntegrator

integrator = TourlyDataIntegrator()
sb = integrator.sb

# Step 1: record current state
before = sb.table("player_profiles").select("player_name,match_history").eq("player_name", "Roan Jones").maybe_single().execute()
before_count = len((before.data or {}).get("match_history") or [])
print(f"Before: Roan Jones has {before_count} match_history entries")
assert before_count > 0, "Roan Jones has no data — pick a different test player"

# Step 2: call upsert with empty match_history (simulates rate-limited scrape)
fake_profile = {
    "player_name": "Roan Jones",
    "ipin": "RoanJones",
    "current_ranking": 1967,
    "match_history": [],
    "ranking_evolution": [],
    "win_loss_by_surface": {},
    "points_defending": [],
    "last_updated": "2099-01-01T00:00:00+00:00",
}
print("Calling upsert with empty match_history...")
integrator.upsert_player_profile(fake_profile)

# Step 3: verify match_history was NOT overwritten
after = sb.table("player_profiles").select("player_name,match_history").eq("player_name", "Roan Jones").maybe_single().execute()
after_count = len((after.data or {}).get("match_history") or [])
print(f"After:  Roan Jones has {after_count} match_history entries")

if after_count == before_count:
    print("✅  GUARD WORKS — existing match_history was preserved")
else:
    print(f"❌  GUARD FAILED — match_history changed from {before_count} to {after_count}")
    sys.exit(1)
