-- Monthly fixed expenses
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS is_monthly_fixed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fixed_month      text;    -- 'YYYY-MM', only set when is_monthly_fixed = true

-- Tournament supervisor contact (populated by scraper)
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS supervisor_name  text,
  ADD COLUMN IF NOT EXISTS supervisor_email text,
  ADD COLUMN IF NOT EXISTS supervisor_phone text,
  ADD COLUMN IF NOT EXISTS fact_sheet_url   text;

-- Player IPIN number on profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS ipin_number text;
