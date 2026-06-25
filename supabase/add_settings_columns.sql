-- Add settings-related columns to profiles table
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS travel_with_coach text,
  ADD COLUMN IF NOT EXISTS travel_with_stringing text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS notify_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_singles boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_singles_reminders integer DEFAULT 3,
  ADD COLUMN IF NOT EXISTS notify_withdrawal boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_withdrawal_reminders integer DEFAULT 3,
  ADD COLUMN IF NOT EXISTS notify_freeze boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_freeze_reminders integer DEFAULT 3;
