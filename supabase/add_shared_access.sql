-- Shared access table: allows a player to grant read access to a coach/agent
CREATE TABLE IF NOT EXISTS shared_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_with_email text NOT NULL,
  shared_with_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'viewer',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  accepted_at timestamptz,
  UNIQUE (owner_id, shared_with_email)
);

-- RLS policies
ALTER TABLE shared_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can see their own shares"
  ON shared_access FOR SELECT
  USING (auth.uid() = owner_id OR auth.uid() = shared_with_id);

CREATE POLICY "Users can create shares"
  ON shared_access FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own shares"
  ON shared_access FOR DELETE
  USING (auth.uid() = owner_id);

CREATE POLICY "Invitees can accept shares"
  ON shared_access FOR UPDATE
  USING (auth.uid() = shared_with_id)
  WITH CHECK (
    auth.uid() = shared_with_id
    AND status = 'accepted'
    AND role = 'viewer'
  );

CREATE POLICY "Owners can update their shares"
  ON shared_access FOR UPDATE
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- View for shared tournament data (read-only for shared users)
CREATE OR REPLACE VIEW shared_tournaments AS
SELECT t.*, sa.shared_with_id, sa.shared_with_email
FROM tournaments t
JOIN shared_access sa ON sa.owner_id = t.user_id
WHERE sa.status = 'accepted';

CREATE OR REPLACE VIEW shared_expenses AS
SELECT e.*, sa.shared_with_id, sa.shared_with_email
FROM expenses e
JOIN shared_access sa ON sa.owner_id = e.user_id
WHERE sa.status = 'accepted';
