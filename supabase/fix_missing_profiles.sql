-- ============================================================
-- Run this in the Supabase SQL editor (one time).
--
-- Problem: users who signed up before the profiles table existed,
-- or who never completed onboarding, have no row in `profiles`.
-- The app's AuthGate sees profile === null and routes them to
-- onboarding forever.
--
-- This script:
--   1. Inserts a minimal profile row (onboarding_complete = true)
--      for every auth.users entry that is missing one.
--   2. Sets onboarding_complete = true for any existing profile
--      rows where it is null or false (pre-migration accounts).
--   3. Creates a trigger so every future signup automatically
--      gets a profile row, preventing this from recurring.
-- ============================================================

-- Step 1: Backfill missing profile rows for all existing auth users.
INSERT INTO public.profiles (id, onboarding_complete, created_at)
SELECT
  u.id,
  true,
  now()
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;

-- Step 2: Mark any existing rows with onboarding_complete = null/false
-- as complete — these users clearly existed before the field was added.
UPDATE public.profiles
SET onboarding_complete = true
WHERE onboarding_complete IS NULL OR onboarding_complete = false;

-- Step 3: Create a trigger so new signups always get a profile row.
-- This means the app will always find a row; onboarding_complete = false
-- signals a brand-new user who needs to go through onboarding.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, onboarding_complete, created_at)
  VALUES (NEW.id, false, now())
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Drop the trigger if it already exists, then recreate it.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Verify: this should return 0 rows if the backfill worked.
SELECT u.id, u.email
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;
