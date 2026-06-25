ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS notify_reminder_config jsonb
DEFAULT '{"singles":["7d","2d","2h"],"withdrawal":["7d","2d","2h"],"freeze":["7d","2d","2h"]}';
