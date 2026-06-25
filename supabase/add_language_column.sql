-- Add language preference column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS language text DEFAULT 'en';
