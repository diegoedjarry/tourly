import { Redirect } from 'expo-router';

// Legacy InstantDB magic-code verify screen — replaced by the Supabase /auth screen.
export default function VerifyScreen() {
  return <Redirect href="/auth" />;
}
