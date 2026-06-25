import { Redirect } from 'expo-router';

// Legacy InstantDB sign-in — replaced by the Supabase /auth screen.
export default function SignInScreen() {
  return <Redirect href="/auth" />;
}
