import { Redirect } from 'expo-router';

// Legacy InstantDB sign-up — replaced by the Supabase /auth screen.
export default function SignUpScreen() {
  return <Redirect href="/auth" />;
}
