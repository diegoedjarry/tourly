-- Run this in the Supabase SQL editor.
-- Creates a secure RPC function that deletes all data for the calling user
-- and then removes their auth account.

create or replace function delete_user_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Delete user data in dependency order
  delete from insights     where user_id = uid;
  delete from expenses     where user_id = uid;
  delete from tournaments  where user_id = uid;
  delete from profiles     where id = uid;

  -- Delete the auth account itself
  delete from auth.users where id = uid;
end;
$$;

-- Only the authenticated user can call this function
revoke all on function delete_user_account() from public;
grant execute on function delete_user_account() to authenticated;
